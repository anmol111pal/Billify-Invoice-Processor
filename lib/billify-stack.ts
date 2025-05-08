import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import { Construct } from 'constructs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { RestApi, Cors, LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';

export class BillifyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const billifyQueue = new Queue(this, 'BillifyQueue', {
      queueName: 'billify-queue',
      visibilityTimeout: cdk.Duration.seconds(300),
    });
    
    const billTable = new Table(this, 'BillifyTable', {
      tableName: 'billify-table',
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: AttributeType.STRING,
      },
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const billBucket = new Bucket(this, 'BillifyBucket', {
      bucketName: 'billify-bucket',
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const invoiceUploaderFunction = new NodejsFunction(this, 'Invoice-Upload-Function', {
      functionName: 'Invoice-Upload-Function',
      description: 'This function uploads the invoice to S3 bucket & sends a message to SQS queue for further processing',
      runtime: Runtime.NODEJS_LATEST,
      memorySize: 512,
      environment: {
        REGION: this.region,
        BUCKET_NAME: billBucket.bucketName,
        QUEUE_URL: billifyQueue.queueUrl,
      },
      handler: 'handler',
      entry: path.join(__dirname, '..', 'lambda', 'uploadInvoice', 'index.ts'),
      bundling: {
        externalModules: [
          '@aws-sdk/client-s3',
          '@aws-sdk/client-sqs',
        ],
        minify: true,
      },
    });

    const api = new RestApi(this, 'Invoice-Upload-API', {
      restApiName: 'Invoice-Upload-API',
      description: 'This provides an API for uploading an invoice & other metadata about the invoice',
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
      },
      binaryMediaTypes: [
        'multipart/form-data',
        'image/png',
        'image/jpg',
        '*/*',
      ],
    });

    const uploadInvoiceRoute = api.root.addResource('upload-invoice');
    uploadInvoiceRoute.addMethod('POST', new LambdaIntegration(invoiceUploaderFunction, {
      proxy: true,
    }));
    
    billBucket.grantPut(invoiceUploaderFunction);
    billifyQueue.grantSendMessages(invoiceUploaderFunction);

    const extractBillInfoHandler = new Function(this, 'ExtractBillInfoHandler', {
      functionName: 'extractBillInfoHandler',
      description: 'This function extracts essential info from the invoice by invoking Amazon Textract, saves the info into a ddb table & sends out an email to the user',
      runtime: Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: Code.fromAsset(path.join(__dirname, '..', 'lambda', 'extractBillInfo')),
      memorySize: 512,
      environment: {
        TABLE_NAME: billTable.tableName,
        BUCKET_NAME: billBucket.bucketName,
        REGION: this.region,
      },
    });

    
    billBucket.grantRead(extractBillInfoHandler);
    billTable.grantWriteData(extractBillInfoHandler);

    extractBillInfoHandler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['textract:AnalyzeExpense'],
      resources: ['*'],
    }));

    const monthlyBillAggregatorRule = new Rule(this, 'MonthlyBillAggregatorRule', {
      ruleName: 'monthlyBillAggregatorRule',
      schedule: Schedule.cron({
        day: '1',
        month: '*',
        hour: '11',
        minute: '0',
      }),
    });

    const billAggregateHandler = new Function(this, 'BillAggregateHandler', {
      functionName: 'billAggregateHandler',
      description: 'This function aggregates the bills for all users & sends a consolidated bill for their monthly spend',
      runtime: Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: Code.fromAsset(path.join(__dirname, '..', 'lambda', 'aggregateBills')),
      memorySize: 512,
      environment: {
        TABLE_NAME: billTable.tableName,
        BUCKET_NAME: billBucket.bucketName,
        REGION: this.region,
      },
    });

    const sendEmailPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ses:SendEmail',
        'ses:SendRawEmail',
      ],
      resources: ['*'],
    });

    const verifyEmailIdentityPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ses:GetIdentityVerificationAttributes',
        'ses:VerifyEmailIdentity',
      ],
      resources: ['*'],
    });

    invoiceUploaderFunction.addToRolePolicy(verifyEmailIdentityPolicy);

    billAggregateHandler.addToRolePolicy(verifyEmailIdentityPolicy);
    billAggregateHandler.addToRolePolicy(sendEmailPolicy);

    extractBillInfoHandler.addToRolePolicy(verifyEmailIdentityPolicy);
    extractBillInfoHandler.addToRolePolicy(sendEmailPolicy);

    extractBillInfoHandler.addEventSource(new SqsEventSource(billifyQueue));
    monthlyBillAggregatorRule.addTarget(new LambdaFunction(billAggregateHandler));
    billTable.grantReadData(billAggregateHandler);
  }
}

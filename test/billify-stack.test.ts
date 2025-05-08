import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as Billify from '../lib/billify-stack';

describe('Billify Stack', () => {
    let stack: cdk.Stack;
    let template: Template;

    beforeEach(() => {
        const app = new cdk.App();
        stack = new Billify.BillifyStack(app, 'MyTestStack');
        template = Template.fromStack(stack);
    });

    test('S3 Bucket Created', () => {
        template.hasResourceProperties('AWS::S3::Bucket', Match.objectLike({
            BucketName: 'billify-bucket',
            VersioningConfiguration: {
                Status: 'Enabled',
            },
        }));
    });

    test('SQS Queue Created', () => {
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'billify-queue',
            VisibilityTimeout: 300,
        });
    });

    test('API Gateway Created', () => {
        template.hasResourceProperties('AWS::ApiGateway::RestApi', {
            Name: 'Invoice-Upload-API',
            BinaryMediaTypes: [
                'multipart/form-data',
                'image/png',
                'image/jpg',
                '*/*',
            ],
        });
    });

    test('Invoice Upload Lambda Created', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'Invoice-Upload-Function',
        });
    });

    test('Extract Bill Info Lambda Created', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'extractBillInfoHandler',
        });
    });

    test('Aggregate Bill Lambda Created', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'billAggregateHandler',
        });
    });
    
    test('MonthlyBillAggregatorRule created with cron schedule', () => {
        template.hasResourceProperties('AWS::Events::Rule', {
            ScheduleExpression: 'cron(0 11 1 * ? *)'
        });
    });

    test('Dynamo DB Table Created', () => {
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'billify-table',
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

});


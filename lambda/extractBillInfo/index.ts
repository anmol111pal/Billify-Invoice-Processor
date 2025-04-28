import { SqsMessage, Bill } from '../../utils/types';
import { SQSEvent } from 'aws-lambda';
import { TextractClient, AnalyzeExpenseCommand } from '@aws-sdk/client-textract';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';

const REGION = process.env.REGION || 'ap-south-1';
const BUCKET_NAME = process.env.BUCKET_NAME;
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event: Readonly<SQSEvent>) => {
  for (const record of event.Records) {
    const sqsMsg: SqsMessage = JSON.parse(record.body);

    if (!sqsMsg.id || !sqsMsg.name || !sqsMsg.email || !sqsMsg.s3Key || !sqsMsg.timestamp) {
      console.error('Missing fields in SQS message body');
      continue;
    }

    console.log(`Invoice processing initiated for ${sqsMsg.name} for invoice - ${sqsMsg.s3Key}.`);

    const billDoc: Bill = await extractInfoFromInvoice(sqsMsg);

    await saveBillInfo(billDoc);

    await sendEmail(billDoc);
  }
};

const extractInfoFromInvoice = async (sqsMsg: Readonly<SqsMessage>) => {
  const billDoc: Bill = {
    id: sqsMsg.id,
    name: sqsMsg.name,
    email: sqsMsg.email,
    total: 0,
    timestamp: sqsMsg.timestamp,
  };

  try {
    const textractClient = new TextractClient({
      region: REGION,
    });

    const analyzeExpenseCommand = new AnalyzeExpenseCommand({
      Document: {
        S3Object: {
          Bucket: BUCKET_NAME,
          Name: sqsMsg.s3Key,
        },
      },
    });

    const textractResponse = await textractClient.send(analyzeExpenseCommand);
    console.log('Textract Analyze Expense: ', textractResponse);

    textractResponse.ExpenseDocuments?.forEach((doc) => {
      doc.SummaryFields?.forEach(field => {
        const label = field.Type?.Text;
        const value = field.ValueDetection?.Text;

        if (label && value) {
          switch (label) {
            case 'TOTAL': billDoc.total = Number(value);
              break;

            case 'VENDOR_NAME': billDoc.vendorName = value.trim();
              break;
          }
        }
      });

      console.log('Invoice extraction successful: ', billDoc);
      return billDoc;
    });

  } catch (err) {
    console.error(`Some error occurred while extracting expense info from invoice for - ${sqsMsg.s3Key}`);
  }

  return billDoc;
};

const saveBillInfo = async (billDoc: Readonly<Bill>) => {
  const dynamodbClient = new DynamoDBClient({
    region: REGION,
  });

  const ddbDocClient = DynamoDBDocumentClient.from(dynamodbClient);

  try {
    const putCommand = new PutCommand({
      TableName: TABLE_NAME,
      Item: billDoc,
    });

    await ddbDocClient.send(putCommand);
    console.log('Saved invoice details to ddb.');
  } catch (err) {
    console.error('Error while saving invoice info to ddb.', err);
  }
};

const sendEmail = async (billDoc: Readonly<Bill>) => {
  const sesClient = new SESClient({
    region: REGION,
  });

  const params = {
    Source: 'anmol111pal@gmail.com',
    Destination: {
      ToAddresses: [billDoc.email],
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: `Your invoice has been processed for ${billDoc.total} `,
      },
      Body: {
        Charset: 'UTF-8',
        Text: {
          Charset: 'UTF-8',
          Data: `Hello, \n\nYour invoice has been processed successfully.\nThe total amount for this invoice is ${billDoc.total}`,
        },
        Html: {
          Charset: 'UTF-8',
          Data: `<html>
                     <body>
                       <p>Hello ${billDoc.name},</p>
                       <p>Your invoice has been <strong>successfully processed</strong>.</p>
                       <p>The total amount for this invoice is <strong>₹${billDoc.total}</strong>.</p>
                       <p>Thank you for using our service.</p>
                       <br/>
                       <p>Billify</p>
                     </body>
                   </html>`,
        }
      },

    },
  };

  try {
    const sendEmailCommand = new SendEmailCommand(params);
    const sendEmailResponse = await sesClient.send(sendEmailCommand);
    console.log(`Email sent successfully - ${sendEmailResponse}`);

  } catch (err) {
    console.error(`Error while sending email to ${billDoc.email}`, err);
  }
};

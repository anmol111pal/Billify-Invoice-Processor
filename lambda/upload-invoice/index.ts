import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { GetIdentityVerificationAttributesCommand, SESClient, VerifyEmailIdentityCommand } from '@aws-sdk/client-ses';
import { parse, MultipartFile } from 'lambda-multipart-parser';
import { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const BUCKET_NAME = process.env.BUCKET_NAME;
const QUEUE_URL = process.env.QUEUE_URL;

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent) => {
    try {
        const parsedEvent = await parse(event);

        const file: MultipartFile = parsedEvent.files[0];
        const name: string = parsedEvent.name;
        const email: string = parsedEvent.email;

        console.log(`Received an invoice processing request by ${name} with invoice - ${file}`);

        const s3Client = new S3Client({
            region: REGION,
        });

        const sqsClient = new SQSClient({
            region: REGION,
        });

        const sesClient = new SESClient({
            region: REGION,
        });

        const verificationAttributesResponse = await sesClient.send(
            new GetIdentityVerificationAttributesCommand({
                Identities: [email],
            })
        );

        const verificationStatus = verificationAttributesResponse.VerificationAttributes?.[email]?.VerificationStatus;

        if (verificationStatus !== 'Success') {
            await sesClient.send(new VerifyEmailIdentityCommand({
                EmailAddress: email,
            }));

            console.log('Sent an email to the user to verify it.');
        }

        const putObjectCommand = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: file.filename,
            ContentType: file.contentType,
            Body: file.content,
            ContentEncoding: file.encoding,
        });

        await s3Client.send(putObjectCommand);
        console.log(`Invoice - ${file.filename} uploaded successfully.`);

        const sendMessageCommand = new SendMessageCommand({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                name,
                email,
                s3Key: file.filename,
                timestamp: new Date().toISOString(),
                id: uuidv4(),
            }),
        });

        await sqsClient.send(sendMessageCommand);
        console.log('Message sent to SQS for further processing.');

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Verify your email address using the URL provided in the mail.',
            }),
        };

    } catch (err) {
        console.error('Error while processing request.', err);

        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error while processing request.' + err,
            }),
        };
    }
};

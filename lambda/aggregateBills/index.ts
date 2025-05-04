import { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Bill } from '../../utils/types';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';

const REGION = process.env.REGION || 'ap-south-1';
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event: Readonly<ScheduledEvent>) => {

    await generateMonthlyBills();

    return {
        statusCode: 200,
        body: JSON.stringify('Monthly bills generated & notified each user via email.'),
    };
};

const generateMonthlyBills = async () => {
    const ddbClient = new DynamoDBClient({
        region: REGION,
    });

    const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

    try {

        const scanResult = await ddbDocClient.send(
            new ScanCommand({
                TableName: TABLE_NAME
            })
        );

        const scannedItems = (scanResult?.Items as Array<Bill>) || [];

        if (!Array.isArray(scannedItems) || scannedItems.length === 0) {
            console.log('No items present in the ddb.');
            return;
        }

        const totalsByEmail: Record<string, number> = {};

        scannedItems.forEach((bill: Readonly<Bill>) => {
            if (!totalsByEmail[bill.email]) {
                totalsByEmail[bill.email] = 0;
            }

            totalsByEmail[bill.email] += bill.total;
        });

        console.log('Aggregated Total: ', totalsByEmail);
        await Promise.all(
            Object.entries(totalsByEmail).map(([email, totalBillAmount]) =>
                sendEmail(email, totalBillAmount)
            )
        );

    } catch (err) {
        console.error('Error occurred while scanning ddb: ', err);
        return {
            statusCode: 500,
            body: JSON.stringify('Error occurred while scanning ddb'),
            error: err,
        };
    }

    return {};
};

const sendEmail = async (email: string, billAmount: number) => {
    const sesClient = new SESClient({
        region: REGION,
    });

    const monthNames = [
        "January", "February", "March",
        "April", "May", "June",
        "July", "August", "September",
        "October", "November", "December"
    ];

    const monthName = monthNames[new Date().getMonth()];

    const rawMessageString = [
        `From: anmol111pal@gmail.com`,
        `To: ${email}`,
        `Subject: Expense Report - ${monthName} - Amount: ${billAmount}`,
        '',
        `You have an expense report for the month of ${monthName} for ${billAmount}`,
        '',
        'Thanks,',
        'Billify',
    ].join('\r\n');

    const rawMessageBytes = Buffer.from(rawMessageString);

    try {
        const sendRawEmailCommand = new SendRawEmailCommand({
            RawMessage: {
                Data: rawMessageBytes,
            },
            Destinations: [email],
        });

        const sendRawEmailCommandOutput = await sesClient.send(sendRawEmailCommand);
        console.log('Email sent successfully - MessageId: ', sendRawEmailCommandOutput.MessageId);

    } catch (err) {
        console.error(`Error while sending email to ${email}: `, err);
    }
};

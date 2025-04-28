export interface Bill {
  id: string,
  name: string,
  email: string,
  total: number,
  timestamp: string,
  vendorName?: string,
};

export interface SqsMessage {
  id: string,
  name: string,
  email: string,
  s3Key: string,
  timestamp: string,
};

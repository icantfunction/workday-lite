import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});

type ApplicationStatus = 'DRAFT' | 'SUBMITTED';

interface ApplicationDraft {
  id: string;
  status: ApplicationStatus;
  resumeKey?: string;
  answers?: Record<string, any>;
  eeo?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface MagicLinkRecord {
  token: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  ttl: number;
}

function pk(id: string) {
  return `APP#${id}`;
}

function sk() {
  return 'META';
}

function magicPk(token: string) {
  return `MAGIC#${token}`;
}

function magicSk() {
  return 'SESSION';
}

function response(statusCode: number, body: any): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true'
    },
    body: JSON.stringify(body)
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const rawPath = event.rawPath;

  try {
    if (rawPath === '/applications' && method === 'POST') {
      return await handleCreateApplication();
    }

    if (rawPath.startsWith('/applications/') && (method === 'GET' || method === 'PUT')) {
      const id = event.pathParameters?.id;
      if (!id) return response(400, { error: 'Missing application id' });

      if (method === 'GET') {
        return await handleGetApplication(id);
      }

      if (method === 'PUT') {
        return await handleUpdateApplication(id, event);
      }
    }

    if (rawPath === '/upload-url' && method === 'POST') {
      return await handleUploadUrl(event);
    }

    if (rawPath === '/magic-link' && method === 'POST') {
      return await handleRequestMagicLink(event);
    }

    if (rawPath === '/magic-link/validate' && method === 'POST') {
      return await handleValidateMagicLink(event);
    }

    return response(404, { error: 'Not found' });
  } catch (err) {
    console.error('Error handling request', { err, event });
    return response(500, { error: 'Internal server error' });
  }
};

async function handleCreateApplication() {
  const id = randomUUID();
  const now = new Date().toISOString();

  const draft: ApplicationDraft = {
    id,
    status: 'DRAFT',
    createdAt: now,
    updatedAt: now
  };

  await ddb.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: pk(id),
        sk: sk(),
        ...draft
      })
    })
  );

  return response(201, draft);
}

async function handleGetApplication(id: string) {
  const res = await ddb.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: pk(id),
        sk: sk()
      })
    })
  );

  if (!res.Item) {
    return response(404, { error: 'Application not found' });
  }

  const item = unmarshall(res.Item) as any;
  const draft: ApplicationDraft = {
    id: item.id,
    status: item.status,
    resumeKey: item.resumeKey,
    answers: item.answers,
    eeo: item.eeo,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };

  return response(200, draft);
}

async function handleUpdateApplication(id: string, event: APIGatewayProxyEventV2) {
  if (!event.body) {
    return response(400, { error: 'Missing body' });
  }

  const input = JSON.parse(event.body) as Partial<ApplicationDraft>;
  const now = new Date().toISOString();

  const draft: ApplicationDraft = {
    id,
    status: input.status ?? 'DRAFT',
    resumeKey: input.resumeKey,
    answers: input.answers ?? {},
    eeo: input.eeo ?? {},
    createdAt: input.createdAt ?? now,
    updatedAt: now
  };

  await ddb.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: pk(id),
        sk: sk(),
        ...draft
      })
    })
  );

  return response(200, draft);
}

async function handleUploadUrl(event: APIGatewayProxyEventV2) {
  if (!event.body) {
    return response(400, { error: 'Missing body' });
  }

  const body = JSON.parse(event.body) as {
    fileName: string;
    contentType: string;
    applicationId: string;
  };

  const key = `resumes/${body.applicationId}/${Date.now()}-${body.fileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: body.contentType
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 60 * 5 });

  return response(200, {
    uploadUrl: url,
    key
  });
}

async function handleRequestMagicLink(event: APIGatewayProxyEventV2) {
  if (!event.body) {
    return response(400, { error: 'Missing body' });
  }

  const body = JSON.parse(event.body) as { email?: string };
  const email = body.email?.trim().toLowerCase();

  if (!email) {
    return response(400, { error: 'Email is required' });
  }

  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 30); // 30 minutes

  const record: MagicLinkRecord = {
    token,
    email,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ttl: Math.floor(expiresAt.getTime() / 1000)
  };

  await ddb.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: magicPk(token),
        sk: magicSk(),
        ...record
      })
    })
  );

  const origin = event.headers?.origin || event.headers?.Origin;
  const loginUrl = origin ? `${origin.replace(/\/$/, '')}/?token=${token}` : undefined;

  return response(200, {
    ok: true,
    loginUrl,
    token
  });
}

function readBearerToken(event: APIGatewayProxyEventV2) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return header;
}

async function handleValidateMagicLink(event: APIGatewayProxyEventV2) {
  const token = readBearerToken(event);
  if (!token) {
    return response(401, { error: 'Missing token' });
  }

  const res = await ddb.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: magicPk(token),
        sk: magicSk()
      })
    })
  );

  if (!res.Item) {
    return response(401, { error: 'Invalid or expired link' });
  }

  const record = unmarshall(res.Item) as MagicLinkRecord;
  const expiresAt = new Date(record.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    return response(401, { error: 'Link expired' });
  }

  return response(200, {
    ok: true,
    email: record.email,
    expiresAt: record.expiresAt
  });
}

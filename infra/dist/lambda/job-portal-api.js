"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = require("crypto");
const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;
const ddb = new client_dynamodb_1.DynamoDBClient({});
const s3 = new client_s3_1.S3Client({});
function pk(id) {
    return `APP#${id}`;
}
function sk() {
    return 'META';
}
function magicPk(token) {
    return `MAGIC#${token}`;
}
function magicSk() {
    return 'SESSION';
}
function response(statusCode, body) {
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
const handler = async (event) => {
    const method = event.requestContext.http.method;
    const rawPath = event.rawPath;
    try {
        if (rawPath === '/applications' && method === 'POST') {
            return await handleCreateApplication();
        }
        if (rawPath.startsWith('/applications/') && (method === 'GET' || method === 'PUT')) {
            const id = event.pathParameters?.id;
            if (!id)
                return response(400, { error: 'Missing application id' });
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
    }
    catch (err) {
        console.error('Error handling request', { err, event });
        return response(500, { error: 'Internal server error' });
    }
};
exports.handler = handler;
async function handleCreateApplication() {
    const id = (0, crypto_1.randomUUID)();
    const now = new Date().toISOString();
    const draft = {
        id,
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now
    };
    await ddb.send(new client_dynamodb_1.PutItemCommand({
        TableName: TABLE_NAME,
        Item: (0, util_dynamodb_1.marshall)({
            pk: pk(id),
            sk: sk(),
            ...draft
        })
    }));
    return response(201, draft);
}
async function handleGetApplication(id) {
    const res = await ddb.send(new client_dynamodb_1.GetItemCommand({
        TableName: TABLE_NAME,
        Key: (0, util_dynamodb_1.marshall)({
            pk: pk(id),
            sk: sk()
        })
    }));
    if (!res.Item) {
        return response(404, { error: 'Application not found' });
    }
    const item = (0, util_dynamodb_1.unmarshall)(res.Item);
    const draft = {
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
async function handleUpdateApplication(id, event) {
    if (!event.body) {
        return response(400, { error: 'Missing body' });
    }
    const input = JSON.parse(event.body);
    const now = new Date().toISOString();
    const draft = {
        id,
        status: input.status ?? 'DRAFT',
        resumeKey: input.resumeKey,
        answers: input.answers ?? {},
        eeo: input.eeo ?? {},
        createdAt: input.createdAt ?? now,
        updatedAt: now
    };
    await ddb.send(new client_dynamodb_1.PutItemCommand({
        TableName: TABLE_NAME,
        Item: (0, util_dynamodb_1.marshall)({
            pk: pk(id),
            sk: sk(),
            ...draft
        })
    }));
    return response(200, draft);
}
async function handleUploadUrl(event) {
    if (!event.body) {
        return response(400, { error: 'Missing body' });
    }
    const body = JSON.parse(event.body);
    const key = `resumes/${body.applicationId}/${Date.now()}-${body.fileName}`;
    const command = new client_s3_1.PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: body.contentType
    });
    const url = await (0, s3_request_presigner_1.getSignedUrl)(s3, command, { expiresIn: 60 * 5 });
    return response(200, {
        uploadUrl: url,
        key
    });
}
async function handleRequestMagicLink(event) {
    if (!event.body) {
        return response(400, { error: 'Missing body' });
    }
    const body = JSON.parse(event.body);
    const email = body.email?.trim().toLowerCase();
    if (!email) {
        return response(400, { error: 'Email is required' });
    }
    const token = (0, crypto_1.randomUUID)();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 30); // 30 minutes
    const record = {
        token,
        email,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttl: Math.floor(expiresAt.getTime() / 1000)
    };
    await ddb.send(new client_dynamodb_1.PutItemCommand({
        TableName: TABLE_NAME,
        Item: (0, util_dynamodb_1.marshall)({
            pk: magicPk(token),
            sk: magicSk(),
            ...record
        })
    }));
    const origin = event.headers?.origin || event.headers?.Origin;
    const loginUrl = origin ? `${origin.replace(/\/$/, '')}/?token=${token}` : undefined;
    return response(200, {
        ok: true,
        loginUrl,
        token
    });
}
function readBearerToken(event) {
    const header = event.headers?.authorization || event.headers?.Authorization;
    if (!header)
        return null;
    const parts = header.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
        return parts[1];
    }
    return header;
}
async function handleValidateMagicLink(event) {
    const token = readBearerToken(event);
    if (!token) {
        return response(401, { error: 'Missing token' });
    }
    const res = await ddb.send(new client_dynamodb_1.GetItemCommand({
        TableName: TABLE_NAME,
        Key: (0, util_dynamodb_1.marshall)({
            pk: magicPk(token),
            sk: magicSk()
        })
    }));
    if (!res.Item) {
        return response(401, { error: 'Invalid or expired link' });
    }
    const record = (0, util_dynamodb_1.unmarshall)(res.Item);
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

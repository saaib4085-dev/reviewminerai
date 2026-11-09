export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function handleError(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error('Unhandled error:', err);
  return json(
    { error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.' } },
    500,
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'The request could not be read. Please try again.');
  }
}

export function requireEnv(env: object, keys: string[]): void {
  const record = env as Record<string, unknown>;
  const missing = keys.filter((k) => !record[k]);
  if (missing.length) {
    console.error('Missing environment variables:', missing.join(', '));
    throw new HttpError(500, 'MISCONFIGURED', 'The app isn’t fully set up yet. Please contact the site owner.');
  }
}

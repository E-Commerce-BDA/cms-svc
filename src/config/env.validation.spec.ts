import { envValidationSchema } from './env.validation.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '4050',
  MONGODB_URI: 'mongodb://127.0.0.1:27018/ecom_cms_test',
  JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
  REDIS_URL: 'redis://localhost:6379',
};

function validate(overrides: Record<string, unknown> = {}) {
  return envValidationSchema.validate(
    { ...validEnv, ...overrides },
    { abortEarly: false, allowUnknown: true },
  );
}

describe('envValidationSchema', () => {
  it('accepts a valid environment and converts the port to a number', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value.PORT).toBe(4050);
    expect(value.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('rejects a missing MongoDB URI', () => {
    const { error } = validate({ MONGODB_URI: undefined });

    expect(error?.message).toContain('MONGODB_URI');
  });

  it('rejects a non-MongoDB URI', () => {
    const { error } = validate({ MONGODB_URI: 'http://localhost/ecom_cms' });

    expect(error?.message).toContain('MONGODB_URI');
  });

  it('rejects a MongoDB URI without a database name', () => {
    const { error } = validate({ MONGODB_URI: 'mongodb://127.0.0.1:27018' });

    expect(error?.message).toContain('MONGODB_URI');
  });

  it('rejects a short JWT secret', () => {
    const { error } = validate({ JWT_SECRET: 'too-short' });

    expect(error?.message).toContain('JWT_SECRET');
  });

  it('rejects an invalid port', () => {
    const { error } = validate({ PORT: 'not-a-port' });

    expect(error?.message).toContain('PORT');
  });

  // cms-007: the storefront call is best-effort, so a misconfigured production
  // deployment would look healthy while every publish served a stale page.
  it('refuses to boot a production instance without REVALIDATE_SECRET', () => {
    const { error } = validate({
      NODE_ENV: 'production',
      STORAGE_LOCAL_DIR: '/var/lib/cms/media',
    });

    expect(error?.message).toContain('REVALIDATE_SECRET');
  });

  it('rejects a REVALIDATE_SECRET too short to be a shared secret', () => {
    const { error } = validate({
      NODE_ENV: 'production',
      STORAGE_LOCAL_DIR: '/var/lib/cms/media',
      REVALIDATE_SECRET: 'short',
    });

    expect(error?.message).toContain('REVALIDATE_SECRET');
  });

  it('accepts a production instance that names both the storefront and the secret', () => {
    const { error, value } = validate({
      NODE_ENV: 'production',
      STORAGE_LOCAL_DIR: '/var/lib/cms/media',
      STOREFRONT_URL: 'https://shop.example.com',
      REVALIDATE_SECRET: 'a-shared-secret-long-enough',
    });

    expect(error).toBeUndefined();
    expect(value.STOREFRONT_URL).toBe('https://shop.example.com');
  });

  it('treats a blank REVALIDATE_SECRET in development as "off", not as a secret', () => {
    const { error, value } = validate({ REVALIDATE_SECRET: '' });

    expect(error).toBeUndefined();
    expect(value.REVALIDATE_SECRET).toBeUndefined();
  });

  it('defaults STOREFRONT_URL to the local storefront and rejects a non-http value', () => {
    expect(validate().value.STOREFRONT_URL).toBe('http://localhost:3000');
    expect(validate({ STOREFRONT_URL: 'localhost:3000' }).error?.message).toContain(
      'STOREFRONT_URL',
    );
  });
});

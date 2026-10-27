import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

const TEST_SECRET = 'test-jwt-secret-at-least-32-characters-long';

function makeContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeRequest(authorization?: string): AuthenticatedRequest {
  return {
    headers: authorization ? { authorization } : {},
  } as unknown as AuthenticatedRequest;
}

describe('JwtAuthGuard', () => {
  const jwtService = new JwtService({ secret: TEST_SECRET });
  const guard = new JwtAuthGuard(jwtService);

  it('attaches the verified user to the request', async () => {
    const token = await jwtService.signAsync(
      { sub: 'admin-1', email: 'admin@example.com', roles: ['admin'] },
      {
        issuer: 'ecom-auth',
        audience: 'ecom-api',
        algorithm: 'HS256',
        expiresIn: '5m',
      },
    );
    const request = makeRequest(`Bearer ${token}`);

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({
      sub: 'admin-1',
      email: 'admin@example.com',
      roles: ['admin'],
    });
  });

  it('rejects a missing authorization header', async () => {
    await expect(
      guard.canActivate(makeContext(makeRequest())),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', async () => {
    await expect(
      guard.canActivate(makeContext(makeRequest('Basic abc'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects malformed Bearer values', async () => {
    await expect(
      guard.canActivate(makeContext(makeRequest('Bearer'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(makeContext(makeRequest('Bearer one two'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid token', async () => {
    await expect(
      guard.canActivate(makeContext(makeRequest('Bearer not-a-jwt'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token issued by another service', async () => {
    const token = await jwtService.signAsync(
      { sub: 'admin-1', email: 'admin@example.com', roles: ['admin'] },
      {
        issuer: 'other-service',
        audience: 'ecom-api',
        algorithm: 'HS256',
        expiresIn: '5m',
      },
    );

    await expect(
      guard.canActivate(makeContext(makeRequest(`Bearer ${token}`))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token issued for another audience', async () => {
    const token = await jwtService.signAsync(
      { sub: 'admin-1', email: 'admin@example.com', roles: ['admin'] },
      {
        issuer: 'ecom-auth',
        audience: 'another-api',
        algorithm: 'HS256',
        expiresIn: '5m',
      },
    );

    await expect(
      guard.canActivate(makeContext(makeRequest(`Bearer ${token}`))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

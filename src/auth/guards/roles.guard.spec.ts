import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';
import type { AuthenticatedUser } from '../access-token.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

class NoRolesController {
  handler() {}
}

class AdminController {
  @Roles('admin')
  handler() {}
}

type ControllerWithHandler = new () => { handler: () => void };

function makeContext(
  controller: ControllerWithHandler,
  user?: AuthenticatedUser,
  headers: Record<string, string> = {},
): ExecutionContext {
  const request = { user, headers } as unknown as AuthenticatedRequest;

  return {
    getHandler: () => controller.prototype.handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows handlers without role metadata', () => {
    expect(guard.canActivate(makeContext(NoRolesController))).toBe(true);
  });

  it('rejects an unauthenticated request when roles are required', () => {
    expect(() => guard.canActivate(makeContext(AdminController))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a user without the required role', () => {
    expect(() =>
      guard.canActivate(
        makeContext(AdminController, {
          sub: 'customer-1',
          email: 'customer@example.com',
          roles: ['customer'],
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows a user with the required role', () => {
    expect(
      guard.canActivate(
        makeContext(AdminController, {
          sub: 'admin-1',
          email: 'admin@example.com',
          roles: ['admin'],
        }),
      ),
    ).toBe(true);
  });

  it('ignores spoofed role headers', () => {
    expect(() =>
      guard.canActivate(
        makeContext(
          AdminController,
          {
            sub: 'customer-1',
            email: 'customer@example.com',
            roles: ['customer'],
          },
          { 'x-roles': 'admin' },
        ),
      ),
    ).toThrow(ForbiddenException);
  });
});

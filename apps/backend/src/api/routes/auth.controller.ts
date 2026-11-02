import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ClientIp,
  ThrottlerRealIpGuard,
} from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { Response, Request } from 'express';

import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { ForgotPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot.password.dto';
import { ResendActivationDto } from '@gitroom/nestjs-libraries/dtos/auth/resend-activation.dto';
import { ApiTags } from '@nestjs/swagger';
import {
  getAuthCookieOptions,
  getCookieSameSite,
  getCookieUrlFromDomain,
} from '@gitroom/helpers/subdomain/subdomain.management';
import { InviteFailure } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { Provider } from '@prisma/client';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import * as Sentry from '@sentry/nestjs';
import { FarcasterProvider } from '@gitroom/nestjs-libraries/integrations/social/farcaster.provider';
import { AFFILIATE_COOKIE_NAME } from '@gitroom/helpers/affiliate/affiliate.cookie';

// Per client address (see getClientIp), on top of the global limits. Every one
// of these is public and either sends an email, checks a password or burns
// CPU on a hash, so each gets its own counter
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

@ApiTags('Auth')
@Controller('/auth')
export class AuthController {
  constructor(
    private _authService: AuthService,
    private _emailService: EmailService
  ) {}

  // The invite in the cookie: its workspace opens, or the app says why it
  // could not be joined (the invite_error cookie is read once by the app)
  private applyInvite(
    response: Response,
    addedOrg: false | { organizationId: string } | { failed: InviteFailure }
  ) {
    if (!addedOrg) {
      return;
    }

    if ('failed' in addedOrg) {
      // already a member is not a problem worth telling
      if (addedOrg.failed !== 'already_member') {
        response.cookie('invite_error', addedOrg.failed, {
          domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
          ...(!process.env.NOT_SECURED
            ? { secure: true, sameSite: getCookieSameSite() }
            : {}),
          expires: new Date(Date.now() + 1000 * 60 * 5),
        });
      }
      return;
    }

    response.cookie('showorg', addedOrg.organizationId, {
      ...getAuthCookieOptions(),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('showorg', addedOrg.organizationId);
    }
  }

  // An invite cookie is spent by the first sign up or sign in that tries it,
  // whatever the outcome, so it can't keep warning that it was used, and a
  // copy-link invite on a shared browser can't add the next person
  private clearInviteCookie(req: Request, response: Response) {
    if (!req?.cookies?.org) {
      return;
    }
    response.clearCookie('org', {
      path: '/',
      ...(!process.env.NOT_SECURED
        ? { domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!) }
        : {}),
    });
  }

  @Get('/can-register')
  async canRegister() {
    return {
      register: await this._authService.canRegister(Provider.LOCAL as string),
    };
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  @Post('/register')
  async register(
    @Req() req: Request,
    @Body() body: CreateOrgUserDto,
    @Res({ passthrough: false }) response: Response,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        req?.cookies?.org
      );

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie,
        req?.cookies?.[AFFILIATE_COOKIE_NAME]
      );

      this.clearInviteCookie(req, response);

      const activationRequired =
        body.provider === 'LOCAL' && this._emailService.hasProvider();

      if (activationRequired) {
        response.header('activate', 'true');
        response.status(200).json({ activate: true });
        return;
      }

      response.cookie('auth', jwt, {
        ...getAuthCookieOptions(),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      this.applyInvite(response, addedOrg);

      Sentry.metrics.count('new_user', 1);
      response.header('onboarding', 'true');
      response.status(200).json({
        register: true,
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('/login')
  async login(
    @Req() req: Request,
    @Body() body: LoginUserDto,
    @Res({ passthrough: false }) response: Response,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        req?.cookies?.org
      );

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie,
        req?.cookies?.[AFFILIATE_COOKIE_NAME]
      );

      this.clearInviteCookie(req, response);

      response.cookie('auth', jwt, {
        ...getAuthCookieOptions(),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      this.applyInvite(response, addedOrg);

      response.header('reload', 'true');
      response.status(200).json({
        login: true,
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  // Same answer whether or not the account exists
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 5, ttl: HOUR } })
  @Post('/forgot')
  async forgot(@Body() body: ForgotPasswordDto) {
    try {
      await this._authService.forgot(body.email);
    } catch (e) {}

    return {
      forgot: true,
    };
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  @Post('/forgot-return')
  async forgotReturn(@Body() body: ForgotReturnPasswordDto) {
    const reset = await this._authService.forgotReturn(body);
    return {
      reset: !!reset,
    };
  }

  @Get('/oauth-mobile-callback')
  mobileCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const scheme = process.env.MOBILE_APP_SCHEME || 'postiz://auth/callback';
    const params = new URLSearchParams();
    if (code) params.set('code', code);
    if (state) params.set('state', state);
    return response.redirect(302, `${scheme}?${params.toString()}`);
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 60, ttl: MINUTE } })
  @Get('/oauth/:provider')
  async oauthLink(
    @Param('provider') provider: string,
    @Query() query: any,
    @Res({ passthrough: true }) response: Response
  ) {
    const state = `login-${makeSecureId(16)}`;
    response.cookie('oauth_state', state, {
      ...getAuthCookieOptions(),
      expires: new Date(Date.now() + 1000 * 60 * 10),
    });

    return this._authService.oauthLink(provider, { ...query, state });
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 20, ttl: HOUR } })
  @Post('/activate')
  async activate(
    @Body('code') code: string,
    @Body('datafast_visitor_id') datafast_visitor_id: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const activate = await this._authService.activate(
      code,
      datafast_visitor_id
    );
    if ('failed' in activate) {
      return response.status(200).json({ can: false, reason: activate.failed });
    }

    response.cookie('auth', activate.jwt, {
      ...getAuthCookieOptions(),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('auth', activate.jwt);
    }

    response.header('onboarding', 'true');

    return response.status(200).json({ can: true });
  }

  // Same answer whether or not the account exists or is already activated
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 5, ttl: HOUR } })
  @Post('/resend-activation')
  async resendActivation(@Body() body: ResendActivationDto) {
    try {
      await this._authService.resendActivationEmail(body.email);
    } catch (e) {}

    return {
      success: true,
    };
  }

  // public and creates a signer at Neynar per call, so cap it per client
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 30, ttl: 3600000 } })
  @Post('/farcaster/signer')
  async farcasterSigner() {
    try {
      return await new FarcasterProvider().createSigner();
    } catch (err: any) {
      return { error: err.message || 'Failed to create signer' };
    }
  }

  // the modal polls every 2s for up to 10 minutes, so leave room for that
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 1000, ttl: 3600000 } })
  @Get('/farcaster/signer')
  async farcasterSignerStatus(@Query('signerUuid') signerUuid: string) {
    try {
      return await new FarcasterProvider().signerStatus(signerUuid);
    } catch (err: any) {
      return { error: err.message || 'Failed to check signer' };
    }
  }

  @Post('/oauth/:provider/redirect')
  oauthRedirect(
    @Param('provider') provider: string,
    @Body('code') code: string,
    @Body('state') state: string,
    @Res({ passthrough: false }) response: Response
  ) {
    if (!code) {
      return response.redirect(303, `${process.env.FRONTEND_URL}/auth/login`);
    }

    const params = new URLSearchParams();
    params.set('code', code);
    if (state) params.set('state', state);
    params.set('provider', provider.toUpperCase());
    return response.redirect(
      303,
      `${process.env.FRONTEND_URL}/auth?${params.toString()}`
    );
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 30, ttl: 10 * MINUTE } })
  @Post('/oauth/:provider/exists')
  async oauthExists(
    @Req() req: Request,
    @Body('code') code: string,
    @Body('redirect_uri') redirect_uri: string,
    @Body('state') state: string,
    @Param('provider') provider: string,
    @Res({ passthrough: false }) response: Response
  ) {
    // a cross-site form post can spoof any body field, a json body cannot
    if (!req.headers['content-type']?.includes('application/json')) {
      return response.status(400).send('Invalid request');
    }

    const { jwt, token, addedOrg } = await this._authService.checkExists(
      provider,
      code,
      redirect_uri,
      state,
      req?.cookies?.oauth_state,
      this._authService.getOrgFromCookie(req?.cookies?.org)
    );

    if (token) {
      return response.json({ token });
    }

    this.clearInviteCookie(req, response);
    this.applyInvite(response, addedOrg || false);

    response.cookie('auth', jwt, {
      ...getAuthCookieOptions(),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('auth', jwt);
    }

    response.header('reload', 'true');

    response.status(200).json({
      login: true,
    });
  }
}

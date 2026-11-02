import { HttpException, Injectable } from '@nestjs/common';
import { Provider, User } from '@prisma/client';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthProviderManager } from '@gitroom/backend/services/auth/providers/providers.manager';
import dayjs from 'dayjs';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import {
  EmailService,
  emailButton,
} from '@gitroom/nestjs-libraries/services/email.service';
import { NewsletterService } from '@gitroom/nestjs-libraries/newsletter/newsletter.service';
import { AffiliateService } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.service';
import { LoginLockoutService } from '@gitroom/nestjs-libraries/services/login.lockout.service';

type InviteCookie = {
  orgId: string;
  role: 'USER' | 'ADMIN';
  id: string;
  email?: string;
};

// the sign-in a provider account uses, as people know it
const providerNames: Partial<Record<Provider, string>> = {
  [Provider.GOOGLE]: 'Google',
  [Provider.GITHUB]: 'GitHub',
  [Provider.APPLE]: 'Apple',
  [Provider.FARCASTER]: 'Farcaster',
  [Provider.WALLET]: 'your wallet',
  [Provider.GENERIC]: 'your company sign-in',
};

export type ActivationFailure = 'expired' | 'invalid' | 'activated';

@Injectable()
export class AuthService {
  constructor(
    private _userService: UsersService,
    private _organizationService: OrganizationService,
    private _emailService: EmailService,
    private _providerManager: AuthProviderManager,
    private _affiliateService: AffiliateService,
    private _loginLockoutService: LoginLockoutService
  ) {}
  async canRegister(provider: string) {
    if (
      process.env.DISABLE_REGISTRATION !== 'true' ||
      provider === Provider.GENERIC
    ) {
      return true;
    }

    return (await this._organizationService.getCount()) === 0;
  }

  async routeAuth(
    provider: Provider,
    body: CreateOrgUserDto | LoginUserDto,
    ip: string,
    userAgent: string,
    addToOrg?: boolean | InviteCookie,
    affiliateCookie?: string
  ) {
    if (provider === Provider.LOCAL) {
      if (process.env.DISALLOW_PLUS && body.email.includes('+')) {
        throw new Error('Email with plus sign is not allowed');
      }
      if (body instanceof CreateOrgUserDto) {
        body.email = body.email.toLowerCase();
      }
      const user = await this._userService.getUserByEmail(body.email);
      if (body instanceof CreateOrgUserDto) {
        if (user) {
          throw new Error('Email already exists');
        }

        if (!(await this.canRegister(provider))) {
          throw new Error('Registration is disabled');
        }

        const create = await this._organizationService.createOrgAndUser(
          body,
          ip,
          userAgent
        );

        await this._affiliateService.attributeOrganization({
          organizationId: create.id,
          userId: create.users[0].user.id,
          email: body.email,
          cookie: affiliateCookie,
        });

        const addedOrg = await this.acceptInvite(
          create.users[0].user.id,
          addToOrg
        );

        const obj = { addedOrg, jwt: await this.jwt(create.users[0].user) };
        await this._emailService.sendEmailSync(
          body.email,
          'Activate your account',
          this.activationEmail(create.users[0].user)
        );
        return obj;
      }

      // a locked email gets the same error as a wrong password, whether or not
      // the account exists
      if (await this._loginLockoutService.isLocked(body.email)) {
        throw new Error('Invalid user name or password');
      }

      if (!user || !AuthChecker.comparePassword(body.password, user.password)) {
        await this._loginLockoutService.recordFailure(body.email);
        throw new Error('Invalid user name or password');
      }

      await this._loginLockoutService.clear(body.email);

      if (!user.activated) {
        throw new Error('User is not activated');
      }

      // an existing account that follows an invite joins on sign in
      return {
        addedOrg: await this.acceptInvite(user.id, addToOrg),
        jwt: await this.jwt(user),
      };
    }

    const user = await this.loginOrRegisterProvider(
      provider,
      body as CreateOrgUserDto,
      ip,
      userAgent,
      affiliateCookie
    );

    const addedOrg = await this.acceptInvite(user.id, addToOrg);
    return { addedOrg, jwt: await this.jwt(user) };
  }

  // The invite in the cookie, accepted by whoever signs up or signs in
  private async acceptInvite(userId: string, addToOrg?: boolean | InviteCookie) {
    if (!addToOrg || typeof addToOrg === 'boolean') {
      return false as const;
    }
    return this._organizationService.addUserToOrg(
      userId,
      addToOrg.id,
      addToOrg.orgId,
      addToOrg.role,
      // email invites can only be accepted by the invited address
      addToOrg.email || undefined
    );
  }

  // A provider sign-up for an email that already has a password account
  // would make a second, empty account
  private async assertNoPasswordAccount(email?: string) {
    const existing = email
      ? await this._userService.getUserByEmail(email)
      : null;
    if (!existing) {
      return;
    }
    throw new HttpException(
      existing.activated
        ? 'This email already has a PostDelegate account. Sign in with your email and password instead.'
        : 'This email already has a PostDelegate account that is not activated yet. Activate it from the email we sent you (you can resend it from the sign in page), then sign in with your email and password.',
      400
    );
  }

  public getOrgFromCookie(cookie?: string) {
    if (!cookie) {
      return false;
    }

    try {
      const getOrg: any = AuthChecker.verifyTypedJWT(cookie, 'invite');
      if (
        typeof getOrg.orgId !== 'string' ||
        typeof getOrg.id !== 'string' ||
        !['USER', 'ADMIN'].includes(getOrg.role) ||
        !getOrg.timeLimit ||
        dayjs(getOrg.timeLimit).isBefore(dayjs())
      ) {
        return false;
      }

      return getOrg as {
        email: string;
        role: 'USER' | 'ADMIN';
        orgId: string;
        id: string;
      };
    } catch (err) {
      return false;
    }
  }

  private async loginOrRegisterProvider(
    provider: Provider,
    body: CreateOrgUserDto,
    ip: string,
    userAgent: string,
    affiliateCookie?: string
  ) {
    const providerInstance = this._providerManager.getProvider(provider);
    const providerUser = await providerInstance.getUser(body.providerToken);

    if (!providerUser) {
      throw new Error('Invalid provider token');
    }

    const user = await this._userService.getUserByProvider(
      providerUser.id,
      provider
    );
    if (user) {
      return user;
    }

    if (!(await this.canRegister(provider))) {
      throw new Error('Registration is disabled');
    }

    await this.assertNoPasswordAccount(providerUser.email);

    const create = await this._organizationService.createOrgAndUser(
      {
        company: body.company,
        email: providerUser.email,
        password: '',
        provider,
        providerId: providerUser.id,
        datafast_visitor_id: body.datafast_visitor_id,
      },
      ip,
      userAgent
    );

    await this._affiliateService.attributeOrganization({
      organizationId: create.id,
      userId: create.users[0].user.id,
      email: providerUser.email,
      cookie: affiliateCookie,
    });

    this._track('register', providerUser.email, body.datafast_visitor_id).catch(
      (err) => {}
    );

    await NewsletterService.register(providerUser.email);

    try {
      if (providerInstance?.postRegistration) {
        await providerInstance.postRegistration(body.providerToken, create.id);
      }
    } catch (err) {
      // Don't fail registration if postRegistration fails
    }

    return create.users[0].user;
  }

  private async _track(
    name: string,
    email: string,
    datafast_visitor_id: string
  ) {
    if (email && datafast_visitor_id && process.env.DATAFAST_API_KEY) {
      try {
        await fetch('https://datafa.st/api/v1/goals', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.DATAFAST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datafast_visitor_id: datafast_visitor_id,
            name: name,
            metadata: {
              email,
            },
          }),
        });
      } catch (err) {}
    }
  }

  // The response of /auth/forgot and /auth/resend-activation must not tell
  // whether an account exists, so the email goes out in the background and
  // a missing account costs the same as a found one
  private sendInBackground(to: string, subject: string, html: string) {
    this._emailService.sendEmailSync(to, subject, html).catch((err) => {
      console.log('Failed to send auth email', err?.message);
    });
  }

  private activationEmail(user: Pick<User, 'id' | 'email'>) {
    const token = AuthChecker.signTypedJWT('activation', {
      id: user.id,
      email: user.email,
    });
    return `Welcome to PostDelegate! Confirm your email address to activate your account.${emailButton(
      `${process.env.FRONTEND_URL}/auth/activate/${token}`,
      'Activate my account'
    )}The link expires in 2 days. If you did not create this account, you can ignore this email.`;
  }

  async forgot(email: string) {
    const user = await this._userService.getUserByEmail(email);
    if (!user) {
      // an account that signs in with Google (or another provider) has no
      // password, it is told how to sign in instead
      const providerUser = await this._userService.getProviderUserByEmail(email);
      if (providerUser) {
        const name =
          providerNames[providerUser.providerName] || 'your sign-in provider';
        this.sendInBackground(
          providerUser.email,
          'How to sign in to PostDelegate',
          `We received a request to reset the password of your PostDelegate account. Your account signs in with ${name}, so it has no password to reset.${emailButton(
            `${process.env.FRONTEND_URL}/auth/login`,
            `Sign in with ${name}`
          )}If you did not ask for this, you can ignore this email.`
        );
      }
      return false;
    }

    // the fingerprint ties the link to the current password, so it works once
    const resetValues = AuthChecker.signTypedJWT('reset', {
      id: user.id,
      pv: AuthChecker.passwordFingerprint(user.password),
    });

    this.sendInBackground(
      user.email,
      'Reset your password',
      `We received a request to reset the password of your PostDelegate account.${emailButton(
        `${process.env.FRONTEND_URL}/auth/forgot/${resetValues}`,
        'Reset my password'
      )}The link expires in 20 minutes. If you did not ask for this, you can ignore this email and your password stays the same.`
    );
    return true;
  }

  async forgotReturn(body: ForgotReturnPasswordDto) {
    let token: { id: string; pv: string };
    try {
      token = AuthChecker.verifyTypedJWT(body.token, 'reset');
    } catch (err) {
      return false;
    }

    if (typeof token.id !== 'string') {
      return false;
    }

    const user = await this._userService.getUserById(token.id);
    if (
      !user ||
      user.providerName !== Provider.LOCAL ||
      token.pv !== AuthChecker.passwordFingerprint(user.password)
    ) {
      return false;
    }

    const updated = await this._userService.updatePassword(
      user.id,
      body.password
    );
    // a forgotten password often comes after failed logins, the new one works
    // right away
    await this._loginLockoutService.clear(user.email);
    return updated;
  }

  async activate(
    code: string,
    tracking: string
  ): Promise<{ jwt: string } | { failed: ActivationFailure }> {
    let token: { id: string; email: string };
    try {
      token = AuthChecker.verifyTypedJWT(code, 'activation');
    } catch (err) {
      return {
        failed:
          (err as Error)?.name === 'TokenExpiredError' ? 'expired' : 'invalid',
      };
    }

    if (typeof token.id !== 'string') {
      return { failed: 'invalid' };
    }

    const user = await this._userService.getUserById(token.id);
    if (!user) {
      return { failed: 'invalid' };
    }
    if (user.activated) {
      return { failed: 'activated' };
    }

    await this._userService.activateUser(user.id);
    this._track('register', user.email, tracking).catch((err) => {});
    await NewsletterService.register(user.email);
    return { jwt: await this.jwt(user) };
  }

  async resendActivationEmail(email: string) {
    const user = await this._userService.getUserByEmail(email);

    if (!user || user.activated) {
      return false;
    }

    this.sendInBackground(
      user.email,
      'Activate your account',
      this.activationEmail(user)
    );

    return true;
  }

  oauthLink(provider: string, query?: any) {
    const providerInstance = this._providerManager.getProvider(provider);
    return providerInstance.generateLink(query);
  }

  async checkExists(
    provider: string,
    code: string,
    redirectUri?: string,
    state?: string,
    stateCookie?: string,
    addToOrg?: boolean | InviteCookie
  ) {
    // the mobile app passes redirect_uri and keeps no cookies, the web flow
    // never passes it, so the state nonce is only enforced for the web flow
    if (
      !process.env.NOT_SECURED &&
      !redirectUri &&
      (!state || state !== stateCookie)
    ) {
      throw new Error('Invalid state');
    }

    const providerInstance = this._providerManager.getProvider(provider);
    const token = await providerInstance.getToken(code, redirectUri);
    const user = await providerInstance.getUser(token);
    if (!user) {
      throw new Error('Invalid user');
    }
    const checkExists = await this._userService.getUserByProvider(
      user.id,
      provider as Provider
    );
    if (checkExists) {
      return {
        jwt: await this.jwt(checkExists),
        // an existing account that follows an invite joins on sign in
        addedOrg: await this.acceptInvite(checkExists.id, addToOrg),
      };
    }

    // a new provider account, unless the email already signs in with a password
    await this.assertNoPasswordAccount(user.email);

    return { token };
  }

  // The session token: who it is and which password it was issued for
  // (so changing the password signs every other session out). Nothing else
  // from the user row, the claims are never trusted for authorization
  private async jwt(user: Pick<User, 'id'>) {
    const current = await this._userService.getUserById(user.id);
    return AuthChecker.signTypedJWT('session', {
      id: user.id,
      pv: AuthChecker.passwordFingerprint(current?.password),
    });
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// What a revocation also takes away: a consent still waiting for its code to
// be exchanged, so a code issued before the revocation can't bring it back
const pendingConsent = {
  authorizationCode: null,
  codeExpiresAt: null,
  codeChallenge: null,
  codeChallengeMethod: null,
  redirectUri: null,
};

@Injectable()
export class OAuthRepository {
  constructor(
    private _oauthApp: PrismaRepository<'oAuthApp'>,
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>,
    private _oauthSelfHosted: PrismaRepository<'oAuthSelfHostedAuthorization'>,
    private _transaction: PrismaTransaction
  ) {}

  getAppByOrgId(orgId: string) {
    return this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        picture: true,
      },
    });
  }

  getAppByClientId(clientId: string) {
    return this._oauthApp.model.oAuthApp.findFirst({
      where: {
        clientId,
        deletedAt: null,
      },
      include: {
        picture: true,
      },
    });
  }

  // One app per organization: checked and created in one serializable
  // transaction (the unique index on organizationId + deletedAt does not stop
  // two live rows, deletedAt is null on both). null: the org already has one
  createApp(
    orgId: string,
    data: {
      name: string;
      description?: string;
      pictureId?: string;
      redirectUrl: string;
      clientId: string;
      clientSecret: string;
    }
  ) {
    return this._transaction.model
      .$transaction(
        async (tx) => {
          const existing = await tx.oAuthApp.findFirst({
            where: {
              organizationId: orgId,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (existing) {
            return null;
          }

          return tx.oAuthApp.create({
            data: {
              organizationId: orgId,
              name: data.name,
              description: data.description,
              pictureId: data.pictureId,
              redirectUrl: data.redirectUrl,
              clientId: data.clientId,
              clientSecret: data.clientSecret,
            },
            include: {
              picture: true,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
      .catch((err) => {
        // the loser of two concurrent creates: the other one made the app
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034'
        ) {
          return null;
        }
        throw err;
      });
  }

  createDynamicApp(data: {
    name: string;
    redirectUrl: string;
    redirectUris: string;
    clientId: string;
    clientSecret?: string;
    tokenEndpointAuthMethod: string;
  }) {
    return this._oauthApp.model.oAuthApp.create({
      data: {
        name: data.name,
        redirectUrl: data.redirectUrl,
        redirectUris: data.redirectUris,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        tokenEndpointAuthMethod: data.tokenEndpointAuthMethod,
        dynamic: true,
      },
    });
  }

  // Dynamic clients register before the consent screen, so abandoned flows
  // leave orphan rows; prune the ones no user ever authorized
  deleteStaleDynamicApps(olderThan: Date) {
    return this._oauthApp.model.oAuthApp.deleteMany({
      where: {
        dynamic: true,
        createdAt: { lt: olderThan },
        authorizations: { none: {} },
        selfHostedAuthorizations: { none: {} },
      },
    });
  }

  async updateApp(
    orgId: string,
    data: {
      name?: string;
      description?: string;
      pictureId?: string;
      redirectUrl?: string;
    }
  ) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data,
      include: {
        picture: true,
      },
    });
  }

  // Every authorization of the app is revoked and the app deleted together:
  // a failure half way never leaves a deleted app with live tokens, or
  // revoked tokens on an app that still works
  async deleteApp(orgId: string) {
    return this._transaction.model.$transaction(async (tx) => {
      const app = await tx.oAuthApp.findFirst({
        where: {
          organizationId: orgId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!app) {
        return null;
      }

      await tx.oAuthSelfHostedAuthorization.updateMany({
        where: { oauthAppId: app.id, revokedAt: null },
        data: { revokedAt: new Date(), ...pendingConsent },
      });
      await tx.oAuthAuthorization.updateMany({
        where: { oauthAppId: app.id, revokedAt: null },
        data: { revokedAt: new Date(), ...pendingConsent },
      });

      return tx.oAuthApp.update({
        where: { id: app.id },
        data: {
          deletedAt: new Date(),
        },
        select: { id: true },
      });
    });
  }

  async updateClientSecret(orgId: string, newSecret: string) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data: {
        clientSecret: newSecret,
      },
    });
  }

  createAuthorization(data: {
    oauthAppId: string;
    userId: string;
    organizationId: string;
    authorizationCode: string;
    codeExpiresAt: Date;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    redirectUri?: string;
  }) {
    return this._oauthAuth.model.oAuthAuthorization.upsert({
      where: {
        oauthAppId_userId_organizationId: {
          oauthAppId: data.oauthAppId,
          userId: data.userId,
          organizationId: data.organizationId,
        },
      },
      create: {
        oauthAppId: data.oauthAppId,
        userId: data.userId,
        organizationId: data.organizationId,
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        codeChallenge: data.codeChallenge || null,
        codeChallengeMethod: data.codeChallengeMethod || null,
        redirectUri: data.redirectUri || null,
      },
      update: {
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        codeChallenge: data.codeChallenge || null,
        codeChallengeMethod: data.codeChallengeMethod || null,
        redirectUri: data.redirectUri || null,
        // A new consent only adds a code: the working token keeps working and
        // a revoked one stays revoked until this code is exchanged
        // (exchangeCodeForToken)
      },
    });
  }

  // Takes every stored form the presented secret could have (hashes under the
  // current and retired keys, plus the legacy ciphertext until the backfill has
  // run) and matches any of them. An empty list matches nothing.
  // Also on a revoked authorization: a revocation clears the pending code
  // (pendingConsent), so a code here was issued by a consent given since
  findByCode(storedCodes: string[]) {
    return this._oauthAuth.model.oAuthAuthorization.findFirst({
      where: {
        authorizationCode: { in: storedCodes },
      },
    });
  }

  // Spends the code it was looked up with, only while it is still that code
  // and not expired: of two concurrent exchanges only one updates the row.
  // The new token replaces the old one and lifts an earlier revocation (the
  // person consented again). null: the code was already spent or replaced
  async exchangeCodeForToken(
    id: string,
    storedCode: string,
    encryptedToken: string
  ) {
    const { count } =
      await this._oauthAuth.model.oAuthAuthorization.updateMany({
        where: {
          id,
          authorizationCode: storedCode,
          codeExpiresAt: { gt: new Date() },
        },
        data: {
          accessToken: encryptedToken,
          revokedAt: null,
          ...pendingConsent,
        },
      });
    if (!count) {
      return null;
    }

    return this._oauthAuth.model.oAuthAuthorization.findUnique({
      where: { id },
      select: {
        organizationId: true,
        organization: {
          select: {
            paymentId: true,
          },
        },
      },
    });
  }

  // A token only works while the person who approved it is still an active,
  // activated member of the organization it was approved for (not removed,
  // disabled or deleted), otherwise it is as good as revoked
  async findByAccessToken(storedTokens: string[]) {
    const authorization = await this._oauthAuth.model.oAuthAuthorization.findFirst(
      {
        where: {
          accessToken: { in: storedTokens },
          revokedAt: null,
          oauthApp: {
            deletedAt: null,
          },
          user: {
            deletedAt: null,
            activated: true,
          },
          organization: {
            deletedAt: null,
          },
        },
        include: {
          oauthApp: {
            select: {
              clientId: true,
              dynamic: true,
              redirectUris: true,
              name: true,
            },
          },
          organization: {
            include: {
              subscription: {
                select: {
                  subscriptionTier: true,
                  totalChannels: true,
                  isLifetime: true,
                },
              },
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              activated: true,
              organizations: {
                select: {
                  organizationId: true,
                  disabled: true,
                },
              },
            },
          },
        },
      }
    );

    if (!authorization) {
      return null;
    }

    const { organizations, ...user } = authorization.user;
    const isMember = organizations.some(
      (membership) =>
        membership.organizationId === authorization.organizationId &&
        !membership.disabled
    );

    return isMember ? { ...authorization, user } : null;
  }

  getApprovedApps(userId: string) {
    return this._oauthAuth.model.oAuthAuthorization.findMany({
      where: {
        userId,
        revokedAt: null,
        accessToken: { not: null },
      },
      include: {
        oauthApp: {
          include: {
            picture: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  revokeAuthorization(userId: string, authId: string) {
    return this._oauthAuth.model.oAuthAuthorization.update({
      where: {
        id: authId,
        userId,
      },
      data: {
        revokedAt: new Date(),
        ...pendingConsent,
      },
      select: { id: true },
    });
  }

  async revokeAllForApp(oauthAppId: string) {
    await this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.updateMany({
      where: {
        oauthAppId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        ...pendingConsent,
      },
    });

    return this._oauthAuth.model.oAuthAuthorization.updateMany({
      where: {
        oauthAppId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        ...pendingConsent,
      },
    });
  }

  // holds the instance API key, so only the id comes back
  createSelfHostedAuthorization(data: {
    oauthAppId: string;
    mcpUrl: string;
    apiKey: string;
    email?: string;
    authorizationCode: string;
    codeExpiresAt: Date;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    redirectUri?: string;
  }) {
    return this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.create({
      select: {
        id: true,
      },
      data: {
        oauthAppId: data.oauthAppId,
        mcpUrl: data.mcpUrl,
        apiKey: data.apiKey,
        email: data.email || null,
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        codeChallenge: data.codeChallenge || null,
        codeChallengeMethod: data.codeChallengeMethod || null,
        redirectUri: data.redirectUri || null,
      },
    });
  }

  // Abandoned consent flows leave rows (and API keys) that never got a token
  deleteAbandonedSelfHostedAuthorizations(olderThan: Date) {
    return this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.deleteMany(
      {
        where: {
          accessToken: null,
          createdAt: { lt: olderThan },
        },
      }
    );
  }

  findSelfHostedByCode(storedCodes: string[]) {
    return this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.findFirst({
      where: {
        authorizationCode: { in: storedCodes },
        revokedAt: null,
      },
      select: {
        id: true,
        oauthAppId: true,
        authorizationCode: true,
        codeExpiresAt: true,
        codeChallenge: true,
        redirectUri: true,
      },
    });
  }

  // Like exchangeCodeForToken: only one exchange of a code wins. false:
  // the code was already spent
  async exchangeSelfHostedCodeForToken(
    id: string,
    storedCode: string,
    encryptedToken: string
  ) {
    const { count } =
      await this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.updateMany(
        {
          where: {
            id,
            authorizationCode: storedCode,
            codeExpiresAt: { gt: new Date() },
            revokedAt: null,
          },
          data: {
            accessToken: encryptedToken,
            ...pendingConsent,
          },
        }
      );
    return count > 0;
  }

  findSelfHostedByAccessToken(storedTokens: string[]) {
    return this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.findFirst({
      where: {
        accessToken: { in: storedTokens },
        revokedAt: null,
      },
      select: {
        id: true,
        oauthAppId: true,
        mcpUrl: true,
        apiKey: true,
      },
    });
  }

  findSelfHostedUserInfo(storedTokens: string[]) {
    return this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.findFirst({
      where: {
        accessToken: { in: storedTokens },
        revokedAt: null,
      },
      select: {
        id: true,
        email: true,
        oauthApp: {
          select: {
            clientId: true,
            dynamic: true,
            redirectUris: true,
          },
        },
      },
    });
  }

  deleteSelfHostedAuthorization(id: string) {
    return this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.deleteMany(
      {
        where: { id },
      }
    );
  }
}

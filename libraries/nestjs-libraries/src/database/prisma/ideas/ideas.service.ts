import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IdeasRepository } from '@gitroom/nestjs-libraries/database/prisma/ideas/ideas.repository';
import {
  CreateIdeaDto,
  UpdateIdeaDto,
} from '@gitroom/nestjs-libraries/dtos/ideas/idea.dto';

@Injectable()
export class IdeasService {
  constructor(private _ideasRepository: IdeasRepository) {}

  // the stored media list parsed, and a deleted campaign left out
  private toIdea<
    T extends {
      media: string | null;
      tag: { deletedAt: Date | null } | null;
    }
  >(idea: T) {
    let media: Array<{ id: string; path: string }> = [];
    try {
      media = idea.media ? JSON.parse(idea.media) : [];
    } catch (err) {
      media = [];
    }
    const { deletedAt, ...tag } = idea.tag || { deletedAt: null };
    return { ...idea, media, tag: idea.tag && !deletedAt ? tag : null };
  }

  private async checkTag(orgId: string, tagId?: string | null) {
    if (!tagId) {
      return null;
    }
    if (!(await this._ideasRepository.tagOfOrg(orgId, tagId))) {
      throw new BadRequestException('This campaign or tag was not found.');
    }
    return tagId;
  }

  private media(media?: CreateIdeaDto['media']) {
    return media?.length
      ? JSON.stringify(media.map(({ id, path }) => ({ id, path })))
      : null;
  }

  async getIdeas(orgId: string) {
    return (await this._ideasRepository.getIdeas(orgId)).map((idea) =>
      this.toIdea(idea)
    );
  }

  async createIdea(orgId: string, userId: string, body: CreateIdeaDto) {
    const idea = await this._ideasRepository.createIdea(orgId, userId, {
      title: body.title.trim(),
      notes: body.notes?.trim() || null,
      media: this.media(body.media),
      tagId: await this.checkTag(orgId, body.tagId),
      status: body.status || 'IDEA',
    });
    return this.toIdea(idea);
  }

  async updateIdea(orgId: string, id: string, body: UpdateIdeaDto) {
    const count = await this._ideasRepository.updateIdea(orgId, id, {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
      ...(body.media !== undefined ? { media: this.media(body.media) } : {}),
      ...(body.tagId !== undefined
        ? { tagId: await this.checkTag(orgId, body.tagId) }
        : {}),
      ...(body.status ? { status: body.status } : {}),
    });
    if (!count) {
      throw new NotFoundException('Idea not found');
    }
    return this.toIdea((await this._ideasRepository.getIdea(orgId, id))!);
  }

  async deleteIdea(orgId: string, id: string) {
    if (!(await this._ideasRepository.deleteIdea(orgId, id))) {
      throw new NotFoundException('Idea not found');
    }
    return { id };
  }
}

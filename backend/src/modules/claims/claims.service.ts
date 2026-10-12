import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateCustomerClaimDto } from './dto/claim.dto';

@Injectable()
export class ClaimsService {
  constructor(private readonly supabase: SupabaseService) {}

  private db() {
    return this.supabase.admin;
  }

  private throwDatabaseError(
    error: { code?: string; message?: string },
    fallback: string,
  ): never {
    if (error.code === 'P0002') {
      throw new NotFoundException(error.message ?? fallback);
    }

    if (error.code === '42501') {
      throw new ForbiddenException(error.message ?? fallback);
    }

    if (['23505', '23514', '40001'].includes(error.code ?? '')) {
      throw new ConflictException(error.message ?? fallback);
    }

    throw new BadRequestException(error.message ?? fallback);
  }

  private async customerId(profileId: string) {
    const { data, error } = await this.db()
      .from('customers')
      .select('id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Customer profile not found');
    }

    return data.id;
  }

  private async requireOwnedOrder(profileId: string, orderId: string) {
    const customerId = await this.customerId(profileId);
    const { data, error } = await this.db()
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Order not found');
    }

    return customerId;
  }

  async create(profileId: string, orderId: string, dto: CreateCustomerClaimDto) {
    const { data, error } = await this.db().rpc(
      'create_customer_order_claim_atomic',
      {
        p_order_id: orderId,
        p_profile_id: profileId,
        p_claim_type: dto.claimType,
        p_description: dto.description,
        p_order_item_id: dto.orderItemId ?? null,
        p_client_request_id: dto.clientRequestId,
      },
    );

    if (error || !data) {
      this.throwDatabaseError(error ?? {}, 'Unable to submit claim');
    }

    return data;
  }

  private async attachSignedUrlsToPhotos(photos: any[]) {
    return Promise.all(
      (photos ?? []).map(async (photo: any) => {
        try {
          if (!this.db()?.storage) {
            console.log('[CLAIM_PHOTO_READ]', {
              claimId: photo.claim_id,
              photoId: photo.id,
              storagePath: photo.storage_path,
              signedUrlGenerated: false,
              expiresIn: 3600,
              supabaseError: 'Storage client not available',
            });
            return {...photo, signedUrl: null};
          }
          const signed = await this.db()
            .storage.from('customer-claim-photos')
            .createSignedUrl(photo.storage_path, 3600);
          const signedUrl = signed.data?.signedUrl ?? null;
          console.log('[CLAIM_PHOTO_READ]', {
            claimId: photo.claim_id,
            photoId: photo.id,
            storagePath: photo.storage_path,
            signedUrlGenerated: Boolean(signedUrl),
            expiresIn: 3600,
            supabaseError: signed.error?.message ?? null,
          });
          return {
            ...photo,
            signedUrl,
          };
        } catch (err: any) {
          console.log('[CLAIM_PHOTO_READ]', {
            claimId: photo.claim_id,
            photoId: photo.id,
            storagePath: photo.storage_path,
            signedUrlGenerated: false,
            expiresIn: 3600,
            supabaseError: err?.message ?? 'Unknown storage error',
          });
          return {...photo, signedUrl: null};
        }
      }),
    );
  }

  async listForOrder(profileId: string, orderId: string) {
    const customerId = await this.requireOwnedOrder(profileId, orderId);
    const { data, error } = await this.db()
      .from('customer_order_claims')
      .select('*,customer_claim_photos(*)')
      .eq('order_id', orderId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException('Unable to load claims');
    }

    const claims = data ?? [];
    return Promise.all(
      claims.map(async (claim: any) => ({
        ...claim,
        customer_claim_photos: await this.attachSignedUrlsToPhotos(
          claim.customer_claim_photos ?? [],
        ),
      })),
    );
  }

  async getOne(profileId: string, claimId: string) {
    const customerId = await this.customerId(profileId);
    const { data, error } = await this.db()
      .from('customer_order_claims')
      .select('*,customer_claim_photos(*)')
      .eq('id', claimId)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Claim not found');
    }

    return {
      ...data,
      customer_claim_photos: await this.attachSignedUrlsToPhotos(
        data.customer_claim_photos ?? [],
      ),
    };
  }

  async createPhotoUpload(profileId: string, claimId: string, fileName: string) {
    const claim = await this.getOne(profileId, claimId);

    if (!['submitted', 'under_review'].includes(claim.status)) {
      throw new ConflictException(
        `Photos cannot be added while claim is ${claim.status}`,
      );
    }

    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
      throw new BadRequestException(
        'Claim photograph must be JPG, JPEG, PNG, or WEBP',
      );
    }

    const path = `${profileId}/${claimId}/${randomUUID()}.${extension}`;
    const { data, error } = await this.db()
      .storage.from('customer-claim-photos')
      .createSignedUploadUrl(path);

    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Unable to create claim photo upload URL',
      );
    }

    return {
      path,
      signedUrl: data.signedUrl,
      token: data.token,
    };
  }

  async attachPhoto(profileId: string, claimId: string, photoPath: string) {
    const { data, error } = await this.db().rpc(
      'attach_customer_claim_photo_atomic',
      {
        p_claim_id: claimId,
        p_profile_id: profileId,
        p_storage_path: photoPath,
      },
    );

    if (error || !data) {
      this.throwDatabaseError(error ?? {}, 'Unable to attach claim photograph');
    }

    return data;
  }
}


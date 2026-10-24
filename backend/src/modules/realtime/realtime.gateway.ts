import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  facilityId?: string | null;
}

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthenticatedUser;
    subscribedRooms?: Set<string>;
  };
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly supabase: SupabaseService) {}

  afterInit() {
    this.logger.log('[RealtimeGateway] WebSocket server initialized');
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const authHeader =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization ||
        (client.handshake.query?.token as string);

      let token: string | null = null;
      if (typeof authHeader === 'string' && authHeader.trim()) {
        token = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : authHeader.trim();
      }

      if (!token) {
        this.logger.warn(
          `[RealtimeGateway] Connection rejected: missing auth token (id: ${client.id})`,
        );
        client.emit('auth_error', { message: 'Authentication token required' });
        client.disconnect(true);
        return;
      }

      // Validate token with Supabase Auth
      const user = await this.supabase.getUser(token);
      if (!user) {
        this.logger.warn(
          `[RealtimeGateway] Connection rejected: invalid token (id: ${client.id})`,
        );
        client.emit('auth_error', {
          message: 'Invalid or expired session token',
        });
        client.disconnect(true);
        return;
      }

      // Fetch user profile and roles
      const { data: profile } = await this.supabase.admin
        .from('profiles')
        .select('id,is_active,facility_id')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile || profile.is_active === false) {
        this.logger.warn(
          `[RealtimeGateway] Connection rejected: inactive profile ${user.id}`,
        );
        client.emit('auth_error', { message: 'Inactive user profile' });
        client.disconnect(true);
        return;
      }

      const { data: roleRows } = await this.supabase.admin
        .from('profile_roles')
        .select('roles(code)')
        .eq('profile_id', user.id);

      const roles = (roleRows || [])
        .map((r: any) => r.roles?.code)
        .filter(Boolean);

      const authUser: AuthenticatedUser = {
        id: user.id,
        email: user.email || null,
        phone: user.phone || null,
        roles,
        facilityId: profile.facility_id || null,
      };

      const subscribedRooms = new Set<string>();

      // Automatically join user-specific room
      const userRoom = `user:${user.id}`;
      client.join(userRoom);
      subscribedRooms.add(userRoom);

      // Join role-specific rooms
      for (const role of roles) {
        const roleRoom = `role:${role}`;
        client.join(roleRoom);
        subscribedRooms.add(roleRoom);
      }

      // Join facility room if applicable
      if (profile.facility_id) {
        const facilityRoom = `facility:${profile.facility_id}`;
        client.join(facilityRoom);
        subscribedRooms.add(facilityRoom);
      }

      client.data = {
        user: authUser,
        subscribedRooms,
      };

      this.logger.log(
        `[RealtimeGateway] Client connected: ${client.id} (user: ${user.id}, roles: [${roles.join(',')}])`,
      );

      client.emit('connection_established', {
        userId: user.id,
        rooms: Array.from(subscribedRooms),
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      this.logger.error(`[RealtimeGateway] Connection error: ${err?.message}`);
      client.emit('auth_error', {
        message: 'Authentication processing failed',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data?.user?.id || 'anonymous';
    this.logger.log(
      `[RealtimeGateway] Client disconnected: ${client.id} (user: ${userId})`,
    );
  }

  @SubscribeMessage('subscribe:order')
  async handleSubscribeOrder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { orderId: string },
  ) {
    const user = client.data?.user;
    if (!user || !data?.orderId) {
      return { ok: false, error: 'Unauthorized or missing orderId' };
    }

    const orderId = data.orderId;
    const isStaff = user.roles.some((r) =>
      ['admin', 'facility', 'driver'].includes(r),
    );

    if (!isStaff) {
      const { data: order } = await this.supabase.admin
        .from('orders')
        .select('id,customer_id')
        .eq('id', orderId)
        .maybeSingle();

      if (!order || order.customer_id !== user.id) {
        return { ok: false, error: 'Access denied to this order' };
      }
    }

    const orderRoom = `order:${orderId}`;
    client.join(orderRoom);
    client.data.subscribedRooms?.add(orderRoom);
    return { ok: true, room: orderRoom };
  }

  @SubscribeMessage('unsubscribe:order')
  handleUnsubscribeOrder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { orderId: string },
  ) {
    if (data?.orderId) {
      const orderRoom = `order:${data.orderId}`;
      client.leave(orderRoom);
      client.data.subscribedRooms?.delete(orderRoom);
      return { ok: true, room: orderRoom };
    }
    return { ok: false };
  }
}

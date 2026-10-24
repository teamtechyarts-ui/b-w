import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import * as crypto from 'crypto';

export interface StandardRealtimePayload {
  eventId: string;
  eventType: string;
  entityId?: string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  facilityId?: string;
  driverId?: string;
  customerId?: string;
  data?: any;
  notification?: any;
  timestamp: string;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  private generateEventId(): string {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private sanitizePayload(data: any): any {
    if (!data || typeof data !== 'object') return data;
    const clone = { ...data };
    delete clone.password;
    delete clone.otp;
    delete clone.driverPin;
    delete clone.pin;
    delete clone.secret;
    delete clone.paymentSecret;
    delete clone.serviceRoleKey;
    return clone;
  }

  private enrichPayload(eventType: string, payload: any): StandardRealtimePayload {
    const sanitized = this.sanitizePayload(payload);
    return {
      eventId: sanitized?.eventId || this.generateEventId(),
      eventType,
      entityId: sanitized?.entityId || sanitized?.id || sanitized?.orderId || '',
      orderId: sanitized?.orderId || (sanitized?.order && sanitized.order.id),
      orderNumber: sanitized?.orderNumber || (sanitized?.order && sanitized.order.order_number),
      status: sanitized?.status || sanitized?.current_status,
      facilityId: sanitized?.facilityId,
      driverId: sanitized?.driverId,
      customerId: sanitized?.customerId || sanitized?.customer_id,
      data: sanitized?.data !== undefined ? sanitized.data : sanitized,
      notification: sanitized?.notification,
      timestamp: sanitized?.timestamp || new Date().toISOString(),
    };
  }

  private toAlternativeEventName(eventName: string): string {
    // Map between dot-case and SNAKE_CASE
    const map: Record<string, string> = {
      'order.created': 'ORDER_CREATED',
      'order.updated': 'ORDER_STATUS_CHANGED',
      'ORDER_CREATED': 'order.created',
      'ORDER_STATUS_CHANGED': 'order.updated',
      'pickup.updated': 'ASSIGNMENT_UPDATED',
      'ASSIGNMENT_UPDATED': 'pickup.updated',
      'delivery.updated': 'ASSIGNMENT_UPDATED',
      'delivery.status_changed': 'ASSIGNMENT_UPDATED',
      'dashboard.updated': 'FACILITY_VERIFICATION',
      'notification.created': 'NOTIFICATION_CREATED',
      'NOTIFICATION_CREATED': 'notification.created',
      'notification.read': 'NOTIFICATION_READ',
      'NOTIFICATION_READ': 'notification.read',
      'task.updated': 'PROCESSING_STAGE_CHANGED',
      'PROCESSING_STAGE_CHANGED': 'task.updated',
    };
    return map[eventName] || eventName;
  }

  emitToUser(userId: string, event: string, payload: any) {
    if (!this.gateway.server) return;
    const enriched = this.enrichPayload(event, payload);
    const altEvent = this.toAlternativeEventName(event);

    this.gateway.server.to(`user:${userId}`).emit(event, enriched);
    if (altEvent !== event) {
      this.gateway.server.to(`user:${userId}`).emit(altEvent, enriched);
    }
  }

  emitToRole(role: string, event: string, payload: any) {
    if (!this.gateway.server) return;
    const enriched = this.enrichPayload(event, payload);
    const altEvent = this.toAlternativeEventName(event);

    this.gateway.server.to(`role:${role}`).emit(event, enriched);
    if (altEvent !== event) {
      this.gateway.server.to(`role:${role}`).emit(altEvent, enriched);
    }
  }

  emitToFacility(facilityId: string, event: string, payload: any) {
    if (!this.gateway.server) return;
    const enriched = this.enrichPayload(event, payload);
    const altEvent = this.toAlternativeEventName(event);

    this.gateway.server.to(`facility:${facilityId}`).emit(event, enriched);
    if (altEvent !== event) {
      this.gateway.server.to(`facility:${facilityId}`).emit(altEvent, enriched);
    }
  }

  emitToOrder(orderId: string, event: string, payload: any) {
    if (!this.gateway.server) return;
    const enriched = this.enrichPayload(event, payload);
    const altEvent = this.toAlternativeEventName(event);

    this.gateway.server.to(`order:${orderId}`).emit(event, enriched);
    if (altEvent !== event) {
      this.gateway.server.to(`order:${orderId}`).emit(altEvent, enriched);
    }
  }

  emitBroadcast(event: string, payload: any) {
    if (!this.gateway.server) return;
    const enriched = this.enrichPayload(event, payload);
    const altEvent = this.toAlternativeEventName(event);

    this.gateway.server.emit(event, enriched);
    if (altEvent !== event) {
      this.gateway.server.emit(altEvent, enriched);
    }
  }

  // Business Event Dispatchers
  emitOrderCreated(order: any, customerId: string, facilityId?: string) {
    const payload = {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.current_status,
      customerId,
      facilityId,
      data: order,
    };
    this.emitToUser(customerId, 'order.created', payload);
    if (facilityId) {
      this.emitToFacility(facilityId, 'order.created', payload);
    }
    this.emitToRole('admin', 'order.created', payload);
    this.emitToRole('driver', 'order.created', payload);
  }

  emitOrderUpdated(order: any, customerId?: string, facilityId?: string) {
    const payload = {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.current_status,
      customerId,
      facilityId,
      data: order,
    };
    if (customerId) {
      this.emitToUser(customerId, 'order.updated', payload);
    }
    this.emitToOrder(order.id, 'order.updated', payload);
    if (facilityId) {
      this.emitToFacility(facilityId, 'order.updated', payload);
    }
    this.emitToRole('admin', 'order.updated', payload);
  }

  emitPickupUpdated(pickup: any, customerId?: string, driverId?: string) {
    const payload = {
      orderId: pickup.order_id || pickup.orderId,
      driverId: driverId || pickup.driver_id,
      status: pickup.status,
      data: pickup,
    };
    if (customerId) this.emitToUser(customerId, 'pickup.updated', payload);
    if (driverId) this.emitToUser(driverId, 'pickup.updated', payload);
    this.emitToRole('admin', 'pickup.updated', payload);
  }

  emitDeliveryUpdated(delivery: any, customerId?: string, driverId?: string) {
    const payload = {
      orderId: delivery.order_id || delivery.orderId,
      driverId: driverId || delivery.driver_id,
      status: delivery.status,
      data: delivery,
    };
    if (customerId) this.emitToUser(customerId, 'delivery.updated', payload);
    if (driverId) this.emitToUser(driverId, 'delivery.updated', payload);
    this.emitToRole('admin', 'delivery.updated', payload);
  }

  emitDashboardUpdated(scope: string, facilityId?: string) {
    const payload = { scope, facilityId };
    if (facilityId) {
      this.emitToFacility(facilityId, 'dashboard.updated', payload);
    }
    this.emitToRole('admin', 'dashboard.updated', payload);
  }

  emitNotificationCreated(profileId: string, notification: any) {
    const payload = {
      profileId,
      notification,
      entityId: notification.id,
      orderId: notification.order_id,
    };
    this.emitToUser(profileId, 'notification.created', payload);
  }

  emitTaskUpdated(task: any, facilityId?: string) {
    const payload = {
      orderId: task.order_id,
      facilityId,
      status: task.status,
      data: task,
    };
    if (facilityId) {
      this.emitToFacility(facilityId, 'task.updated', payload);
    }
    this.emitToRole('admin', 'task.updated', payload);
  }

  emitAttendanceUpdated(driverId: string, status: any) {
    const payload = { driverId, status };
    this.emitToUser(driverId, 'attendance.updated', payload);
    this.emitToRole('admin', 'attendance.updated', payload);
  }
}

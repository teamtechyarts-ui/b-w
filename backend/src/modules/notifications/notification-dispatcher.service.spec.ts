import {
  NotificationDispatcher,
  shouldRunBackgroundQueueWorker,
} from './notification-dispatcher.service';

type DatabaseResponse = {
  data?: unknown;
  error?: unknown;
};

type ExpectedQuery = {
  table: string;
  response: DatabaseResponse;
};

function databaseFixture(
  expectedQueries: ExpectedQuery[],
  rpcHandler?: (
    fnName: string,
    params: Record<string, any>,
  ) => Promise<DatabaseResponse>,
) {
  const calls: Array<{
    table: string;
    methods: Array<{ name: string; arguments: unknown[] }>;
  }> = [];

  const defaultRpc = async (
    fnName: string,
    params: Record<string, any>,
  ): Promise<DatabaseResponse> => {
    if (fnName === 'acquire_or_renew_worker_lease') {
      return {
        data: [
          {
            lease_name: params.p_lease_name,
            holder_id: params.p_holder_id,
            acquired: true,
          },
        ],
        error: null,
      };
    }
    if (fnName === 'release_worker_lease') {
      return { data: true, error: null };
    }
    return { data: null, error: null };
  };

  const db = {
    rpc: jest.fn((fnName: string, params: Record<string, any> = {}) =>
      rpcHandler ? rpcHandler(fnName, params) : defaultRpc(fnName, params),
    ),
    from: jest.fn((table: string) => {
      const expected = expectedQueries.shift();
      if (!expected || expected.table !== table) {
        throw new Error(
          `Unexpected database query for ${table}; expected ${expected?.table ?? 'none'}`,
        );
      }

      const call = { table, methods: [] as Array<{ name: string; arguments: unknown[] }> };
      calls.push(call);
      const builder: any = {};

      for (const name of [
        'select',
        'eq',
        'gte',
        'lt',
        'update',
        'insert',
        'in',
        'order',
        'limit',
      ]) {
        builder[name] = jest.fn((...args: unknown[]) => {
          call.methods.push({ name, arguments: args });
          return builder;
        });
      }

      builder.maybeSingle = jest.fn(async () => expected.response);
      builder.single = jest.fn(async () => expected.response);
      builder.then = (
        resolve: (result: DatabaseResponse) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve(expected.response).then(resolve, reject);

      return builder;
    }),
  };

  return { db, calls, remaining: expectedQueries };
}

const notification = {
  id: 'notification-id',
  profile_id: 'profile-id',
  notification_type: 'order_status',
  title: 'Order update',
  body: 'Your order is ready.',
  data: { orderId: 'order-id', attempt: 2 },
  status: 'queued',
};

function serviceFixture(
  expectedQueries: ExpectedQuery[],
  send: jest.Mock = jest.fn().mockResolvedValue({
    ok: true,
    providerMessageId: 'provider-message-id',
  }),
  configured = true,
  rpcHandler?: (
    fnName: string,
    params: Record<string, any>,
  ) => Promise<DatabaseResponse>,
) {
  const database = databaseFixture(expectedQueries, rpcHandler);
  const provider = { configured, send };
  const service = new NotificationDispatcher(
    { admin: database.db } as any,
    provider,
  );
  return { service, send, provider, ...database };
}

describe('NotificationDispatcher', () => {
  it('dispatches a persisted notification, records a sanitized attempt, and deactivates invalid tokens', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        providerMessageId: 'provider-message-id',
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'invalid_token',
        errorCode: 'messaging/registration-token-not-registered',
      });
    const f = serviceFixture(
      [
        { table: 'notifications', response: { data: notification, error: null } },
        {
          table: 'notifications',
          response: { data: { ...notification, status: 'processing' }, error: null },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        {
          table: 'device_tokens',
          response: {
            data: [
              { id: 'device-a', push_token: 'SECRET_PUSH_TOKEN_A' },
              { id: 'device-b', push_token: 'SECRET_PUSH_TOKEN_B' },
            ],
            error: null,
          },
        },
        { table: 'device_tokens', response: { data: null, error: null } },
        {
          table: 'notification_delivery_attempts',
          response: { data: { attempt_number: 2 }, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: notification.id }, error: null },
        },
      ],
      send,
    );

    await expect(f.service.dispatchPersisted(notification.id)).resolves.toEqual({
      notificationId: notification.id,
      dispatched: true,
      status: 'sent',
      attemptedDeviceCount: 2,
      sentCount: 1,
      failedCount: 1,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, {
      token: 'SECRET_PUSH_TOKEN_A',
      title: notification.title,
      body: notification.body,
      data: {
        notificationId: notification.id,
        notificationType: notification.notification_type,
        orderId: 'order-id',
        attempt: '2',
      },
    });

    const deactivateCall = f.calls[4];
    expect(deactivateCall.methods).toContainEqual({
      name: 'in',
      arguments: ['id', ['device-b']],
    });

    const attemptInsert = f.calls[6].methods.find(
      (method) => method.name === 'insert',
    )?.arguments[0] as Record<string, unknown>;
    expect(attemptInsert).toMatchObject({
      notification_id: notification.id,
      attempt_number: 3,
      status: 'sent',
    });
    expect(JSON.stringify(attemptInsert)).not.toContain('SECRET_PUSH_TOKEN_A');
    expect(JSON.stringify(attemptInsert)).not.toContain('SECRET_PUSH_TOKEN_B');
    expect(f.remaining).toEqual([]);
  });

  it('records a failed attempt when no active devices exist', async () => {
    const f = serviceFixture([
      { table: 'notifications', response: { data: notification, error: null } },
      {
        table: 'notifications',
        response: { data: { ...notification, status: 'processing' }, error: null },
      },
      {
        table: 'notification_preferences',
        response: { data: { push_enabled: true }, error: null },
      },
      { table: 'device_tokens', response: { data: [], error: null } },
      {
        table: 'notification_delivery_attempts',
        response: { data: null, error: null },
      },
      {
        table: 'notification_delivery_attempts',
        response: { data: null, error: null },
      },
      {
        table: 'notifications',
        response: { data: { id: notification.id }, error: null },
      },
    ]);

    await expect(f.service.dispatchPersisted(notification.id)).resolves.toEqual({
      notificationId: notification.id,
      dispatched: true,
      status: 'failed',
      attemptedDeviceCount: 0,
      sentCount: 0,
      failedCount: 0,
      reason: 'no_active_devices',
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('honors disabled push preferences without contacting Firebase', async () => {
    const f = serviceFixture([
      { table: 'notifications', response: { data: notification, error: null } },
      {
        table: 'notifications',
        response: { data: { ...notification, status: 'processing' }, error: null },
      },
      {
        table: 'notification_preferences',
        response: { data: { push_enabled: false }, error: null },
      },
      {
        table: 'notification_delivery_attempts',
        response: { data: null, error: null },
      },
      {
        table: 'notification_delivery_attempts',
        response: { data: null, error: null },
      },
      {
        table: 'notifications',
        response: { data: { id: notification.id }, error: null },
      },
    ]);

    await expect(f.service.dispatchPersisted(notification.id)).resolves.toEqual({
      notificationId: notification.id,
      dispatched: true,
      status: 'cancelled',
      attemptedDeviceCount: 0,
      sentCount: 0,
      failedCount: 0,
      reason: 'push_disabled',
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does not redeliver a notification that has already been sent', async () => {
    const f = serviceFixture([
      {
        table: 'notifications',
        response: { data: { ...notification, status: 'sent' }, error: null },
      },
    ]);

    await expect(f.service.dispatchPersisted(notification.id)).resolves.toEqual({
      notificationId: notification.id,
      dispatched: false,
      status: 'sent',
      attemptedDeviceCount: 0,
      sentCount: 0,
      failedCount: 0,
      reason: 'not_dispatchable',
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('records unexpected provider failures without exposing thrown details', async () => {
    const send = jest.fn().mockRejectedValue(
      new Error('provider message containing device token or credentials'),
    );
    const f = serviceFixture(
      [
        { table: 'notifications', response: { data: notification, error: null } },
        {
          table: 'notifications',
          response: { data: { ...notification, status: 'processing' }, error: null },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        {
          table: 'device_tokens',
          response: {
            data: [{ id: 'device-a', push_token: 'SECRET_PUSH_TOKEN_A' }],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: notification.id }, error: null },
        },
      ],
      send,
    );

    await expect(f.service.dispatchPersisted(notification.id)).resolves.toMatchObject({
      status: 'failed',
      failedCount: 1,
    });
    const attemptInsert = f.calls[5].methods.find(
      (method) => method.name === 'insert',
    )?.arguments[0];
    expect(JSON.stringify(attemptInsert)).not.toContain('provider message');
    expect(JSON.stringify(attemptInsert)).not.toContain('SECRET_PUSH_TOKEN_A');
  });

  it('skips background queue polling when push provider is not configured', async () => {
    const f = serviceFixture([], jest.fn(), false);
    const processed = await f.service.processPendingQueue();
    expect(processed).toBe(0);
    expect(f.db.from).not.toHaveBeenCalled();
  });

  it('throttles failed notification retries and skips permanent or max-attempt failures', async () => {
    const f = serviceFixture([
      { table: 'notifications', response: { data: [], error: null } }, // queued check
      { table: 'notifications', response: { data: [], error: null } }, // stale processing check
      {
        table: 'notifications',
        response: {
          data: [{ id: 'perm-fail' }, { id: 'max-attempt-fail' }],
          error: null,
        },
      }, // failed check
      {
        table: 'notification_delivery_attempts',
        response: {
          data: [
            {
              notification_id: 'perm-fail',
              attempt_number: 1,
              provider_response: { reason: 'no_active_devices' },
            },
            {
              notification_id: 'max-attempt-fail',
              attempt_number: 3,
              provider_response: { reason: 'transient' },
            },
          ],
          error: null,
        },
      },
      // Second call within 15 minutes should only query queued, NOT stale/failed
      { table: 'notifications', response: { data: [], error: null } },
    ]);

    const first = await f.service.processPendingQueue();
    expect(first).toBe(0);

    const second = await f.service.processPendingQueue();
    expect(second).toBe(0);
    expect(f.remaining).toEqual([]);
  });

  describe('background worker designation and lifecycle', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      jest.restoreAllMocks();
    });

    it('primary worker starts background sweeps and retains event-driven dispatch', async () => {
      process.env.NODE_APP_INSTANCE = '0';
      delete process.env.NOTIFICATION_QUEUE_WORKER;
      delete process.env.NOTIFICATION_PRIMARY_WORKER_ID;

      const setNotificationDispatcher = jest.fn();
      const dispatcher = new NotificationDispatcher(
        { admin: {}, setNotificationDispatcher } as any,
        { configured: true, send: jest.fn() },
      );

      dispatcher.onModuleInit();
      try {
        expect(setNotificationDispatcher).toHaveBeenCalledTimes(1);
        const overview = await dispatcher.getDiagnosticOverview().catch(() => null);
        // workerActive reflects queueInterval created on primary worker
        expect((dispatcher as any).queueInterval).not.toBeNull();
        expect(overview).toBeDefined();
      } finally {
        dispatcher.onModuleDestroy();
      }
    });

    it('secondary workers do not start background sweeps but retain event-driven dispatch', () => {
      process.env.NODE_APP_INSTANCE = '1';
      delete process.env.NOTIFICATION_QUEUE_WORKER;
      delete process.env.NOTIFICATION_PRIMARY_WORKER_ID;

      const setNotificationDispatcher = jest.fn();
      const dispatcher = new NotificationDispatcher(
        { admin: {}, setNotificationDispatcher } as any,
        { configured: true, send: jest.fn() },
      );

      dispatcher.onModuleInit();
      expect(setNotificationDispatcher).toHaveBeenCalledTimes(1);
      expect((dispatcher as any).queueInterval).toBeNull();
      dispatcher.onModuleDestroy();
    });

    it('respects explicit NOTIFICATION_QUEUE_WORKER=false disable switch', () => {
      process.env.NODE_APP_INSTANCE = '0';
      process.env.NOTIFICATION_QUEUE_WORKER = 'false';

      const setNotificationDispatcher = jest.fn();
      const dispatcher = new NotificationDispatcher(
        { admin: {}, setNotificationDispatcher } as any,
        { configured: true, send: jest.fn() },
      );

      dispatcher.onModuleInit();
      expect(setNotificationDispatcher).toHaveBeenCalledTimes(1);
      expect((dispatcher as any).queueInterval).toBeNull();
      dispatcher.onModuleDestroy();
    });

    it('supports explicit primary worker designation and handles missing worker identity safely', () => {
      expect(
        shouldRunBackgroundQueueWorker({
          NOTIFICATION_PRIMARY_WORKER_ID: 'worker-a',
          NOTIFICATION_WORKER_ID: 'worker-a',
        } as any),
      ).toBe(true);
      expect(
        shouldRunBackgroundQueueWorker({
          NOTIFICATION_PRIMARY_WORKER_ID: 'worker-a',
          NOTIFICATION_WORKER_ID: 'worker-b',
        } as any),
      ).toBe(false);
      // Missing worker identity when primary ID is set -> does not run
      expect(
        shouldRunBackgroundQueueWorker({
          NOTIFICATION_PRIMARY_WORKER_ID: 'worker-a',
        } as any),
      ).toBe(false);
      // Missing all worker identity env vars -> safe fallback enables recovery
      expect(shouldRunBackgroundQueueWorker({} as any)).toBe(true);
    });

    it('repeated onModuleInit and onModuleDestroy calls do not create duplicate timers', () => {
      process.env.NOTIFICATION_QUEUE_WORKER = 'true';
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      const dispatcher = new NotificationDispatcher(
        { admin: {}, setNotificationDispatcher: jest.fn() } as any,
        { configured: true, send: jest.fn() },
      );

      dispatcher.onModuleInit();
      const firstTimer = (dispatcher as any).queueInterval;
      dispatcher.onModuleInit();
      const secondTimer = (dispatcher as any).queueInterval;

      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
      expect(clearIntervalSpy).toHaveBeenCalledWith(firstTimer);
      expect(secondTimer).not.toBe(firstTimer);

      dispatcher.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalledWith(secondTimer);
      expect((dispatcher as any).queueInterval).toBeNull();
    });

    it('across 4 simulated cluster instances, only instance 0 starts background sweeps while all 4 retain event-driven dispatch', () => {
      const dispatchers = ['0', '1', '2', '3'].map((instanceId) => {
        process.env.NODE_APP_INSTANCE = instanceId;
        delete process.env.NOTIFICATION_QUEUE_WORKER;
        delete process.env.NOTIFICATION_PRIMARY_WORKER_ID;
        const setNotificationDispatcher = jest.fn();
        const instance = new NotificationDispatcher(
          { admin: {}, setNotificationDispatcher } as any,
          { configured: true, send: jest.fn() },
        );
        instance.onModuleInit();
        return { instanceId, instance, setNotificationDispatcher };
      });

      try {
        const activeSweepCount = dispatchers.filter(
          (d) => (d.instance as any).queueInterval !== null,
        ).length;
        expect(activeSweepCount).toBe(1);
        expect((dispatchers[0].instance as any).queueInterval).not.toBeNull();
        for (const d of dispatchers) {
          expect(d.setNotificationDispatcher).toHaveBeenCalledTimes(1);
        }
      } finally {
        for (const d of dispatchers) {
          d.instance.onModuleDestroy();
        }
      }
    });
  });

  describe('distributed lease coordination', () => {
    function createSimulatedLeaseStore(initialNowMs = 1_700_000_000_000) {
      let nowMs = initialNowMs;
      const leases = new Map<
        string,
        { holder_id: string; leased_until_ms: number; updated_at_ms: number }
      >();

      const rpcHandler = async (
        fnName: string,
        params: Record<string, any>,
      ): Promise<DatabaseResponse> => {
        if (fnName === 'acquire_or_renew_worker_lease') {
          const leaseName = String(params.p_lease_name);
          const holderId = String(params.p_holder_id);
          const ttlSeconds = Number(params.p_ttl_seconds);
          const existing = leases.get(leaseName);

          if (
            !existing ||
            existing.leased_until_ms <= nowMs ||
            existing.holder_id === holderId
          ) {
            const next = {
              holder_id: holderId,
              leased_until_ms: nowMs + ttlSeconds * 1000,
              updated_at_ms: nowMs,
            };
            leases.set(leaseName, next);
            return {
              data: [
                {
                  lease_name: leaseName,
                  holder_id: next.holder_id,
                  leased_until: new Date(next.leased_until_ms).toISOString(),
                  acquired: true,
                },
              ],
              error: null,
            };
          }

          return {
            data: [
              {
                lease_name: leaseName,
                holder_id: existing.holder_id,
                leased_until: new Date(existing.leased_until_ms).toISOString(),
                acquired: false,
              },
            ],
            error: null,
          };
        }

        if (fnName === 'verify_worker_lease') {
          const leaseName = String(params.p_lease_name);
          const holderId = String(params.p_holder_id);
          const existing = leases.get(leaseName);
          const valid = Boolean(
            existing &&
              existing.holder_id === holderId &&
              existing.leased_until_ms > nowMs,
          );
          return { data: valid, error: null };
        }

        if (fnName === 'release_worker_lease') {
          const leaseName = String(params.p_lease_name);
          const holderId = String(params.p_holder_id);
          const existing = leases.get(leaseName);
          if (existing && existing.holder_id === holderId) {
            leases.delete(leaseName);
            return { data: true, error: null };
          }
          return { data: false, error: null };
        }

        return { data: null, error: null };
      };

      return {
        rpcHandler,
        advanceMs(ms: number) {
          nowMs += ms;
        },
        getLease(leaseName = 'notification_queue_sweep') {
          return leases.get(leaseName) ?? null;
        },
        forceOwner(
          holderId: string,
          ttlSeconds = 360,
          leaseName = 'notification_queue_sweep',
        ) {
          leases.set(leaseName, {
            holder_id: holderId,
            leased_until_ms: nowMs + ttlSeconds * 1000,
            updated_at_ms: nowMs,
          });
        },
      };
    }

    it('when 4 instances start without NODE_APP_INSTANCE, only 1 acquires the lease and queries notifications', async () => {
      const store = createSimulatedLeaseStore();
      const instances = Array.from({ length: 4 }, () => {
        const db = databaseFixture(
          [
            { table: 'notifications', response: { data: [], error: null } },
            { table: 'notifications', response: { data: [], error: null } },
            { table: 'notifications', response: { data: [], error: null } },
          ],
          store.rpcHandler,
        );
        const setNotificationDispatcher = jest.fn();
        const dispatcher = new NotificationDispatcher(
          { admin: db.db, setNotificationDispatcher } as any,
          { configured: true, send: jest.fn() },
        );
        return { dispatcher, db, setNotificationDispatcher };
      });

      const results = await Promise.all(
        instances.map((item) => item.dispatcher.processPendingQueue()),
      );
      expect(results).toEqual([0, 0, 0, 0]);

      const queryCounts = instances.map((item) => item.db.calls.length);
      expect(queryCounts.filter((count) => count === 3)).toHaveLength(1);
      expect(queryCounts.filter((count) => count === 0)).toHaveLength(3);

      const lease = store.getLease();
      expect(lease).not.toBeNull();
      const winnerIndex = queryCounts.findIndex((count) => count === 3);
      expect(lease?.holder_id).toBe(instances[winnerIndex].dispatcher.getWorkerId());
    });

    it('skips sweeps on other instances while a valid lease exists and allows renewal by the holder', async () => {
      const store = createSimulatedLeaseStore(1_700_000_000_000);
      const primary = serviceFixture(
        [
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
        ],
        undefined,
        true,
        store.rpcHandler,
      );
      const secondary = serviceFixture([], undefined, true, store.rpcHandler);

      await primary.service.processPendingQueue();
      const firstExpiry = store.getLease()?.leased_until_ms ?? 0;

      store.advanceMs(60 * 1000); // 1 minute later (lease still valid)
      await secondary.service.processPendingQueue();
      expect(secondary.calls).toHaveLength(0);
      expect(store.getLease()?.holder_id).toBe(primary.service.getWorkerId());

      store.advanceMs(60 * 1000); // 2 minutes total
      await primary.service.processPendingQueue();
      const renewedExpiry = store.getLease()?.leased_until_ms ?? 0;
      expect(renewedExpiry).toBeGreaterThan(firstExpiry);
      expect(primary.calls).toHaveLength(4);
    });

    it('allows another instance to take over after lease expiry', async () => {
      const store = createSimulatedLeaseStore(1_700_000_000_000);
      const crashedPrimary = serviceFixture(
        [
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
        ],
        undefined,
        true,
        store.rpcHandler,
      );
      const standby = serviceFixture(
        [
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
        ],
        undefined,
        true,
        store.rpcHandler,
      );

      await crashedPrimary.service.processPendingQueue();
      expect(store.getLease()?.holder_id).toBe(
        crashedPrimary.service.getWorkerId(),
      );

      // Advance past the 360-second TTL without renewal
      store.advanceMs(361 * 1000);

      await standby.service.processPendingQueue();
      expect(store.getLease()?.holder_id).toBe(standby.service.getWorkerId());
      expect(standby.calls).toHaveLength(3);
    });

    it('prevents a stale holder from releasing a lease owned by another worker', async () => {
      const store = createSimulatedLeaseStore();
      const staleWorker = serviceFixture([], undefined, true, store.rpcHandler);
      const activeWorker = serviceFixture(
        [
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
        ],
        undefined,
        true,
        store.rpcHandler,
      );

      store.forceOwner(staleWorker.service.getWorkerId(), 10);
      store.advanceMs(15 * 1000);
      await activeWorker.service.processPendingQueue();
      expect(store.getLease()?.holder_id).toBe(activeWorker.service.getWorkerId());

      const released = await staleWorker.service.releaseLease();
      expect(released).toBe(false);
      expect(store.getLease()?.holder_id).toBe(activeWorker.service.getWorkerId());
    });

    function dispatchSuccessQueries(id: string): ExpectedQuery[] {
      return [
        {
          table: 'notifications',
          response: { data: { ...notification, id }, error: null },
        },
        {
          table: 'notifications',
          response: {
            data: { ...notification, id, status: 'processing' },
            error: null,
          },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        {
          table: 'device_tokens',
          response: { data: [{ id: 'dev-1', push_token: 'tok-1' }], error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        { table: 'notifications', response: { data: { id }, error: null } },
      ];
    }

    it('stops processing remaining queued notifications when lease ownership is lost mid-sweep', async () => {
      const store = createSimulatedLeaseStore();
      let renewalAttempt = 0;

      const f = serviceFixture(
        [
          {
            table: 'notifications',
            response: {
              data: [{ id: 'notif-1' }, { id: 'notif-2' }, { id: 'notif-3' }],
              error: null,
            },
          },
          ...dispatchSuccessQueries('notif-1'),
        ],
        jest.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { ok: true, providerMessageId: 'msg-1' };
        }),
        true,
        async (fnName, params) => {
          if (fnName === 'acquire_or_renew_worker_lease') {
            renewalAttempt += 1;
            if (renewalAttempt === 1) {
              return store.rpcHandler(fnName, params);
            }
            // Simulate another worker taking over the lease while notif-1 is in flight
            store.forceOwner('other-worker-uuid', 360);
            return store.rpcHandler(fnName, params);
          }
          return store.rpcHandler(fnName, params);
        },
      );

      const processed = await f.service.processPendingQueue(20, 5);
      expect(processed).toBe(1);
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.remaining).toEqual([]);
    });

    it('fails safely without crashing or querying notifications on RPC or network error', async () => {
      const f = serviceFixture(
        [],
        undefined,
        true,
        async () => ({ data: null, error: { message: 'connection reset' } }),
      );

      await expect(f.service.processPendingQueue()).resolves.toBe(0);
      expect(f.calls).toHaveLength(0);

      const throwing = serviceFixture([], undefined, true, async () => {
        throw new Error('ECONNREFUSED');
      });
      await expect(throwing.service.processPendingQueue()).resolves.toBe(0);
      expect(throwing.calls).toHaveLength(0);
    });

    it('renews the lease periodically during a long-running sweep', async () => {
      const store = createSimulatedLeaseStore();
      let renewCalls = 0;

      const f = serviceFixture(
        [
          {
            table: 'notifications',
            response: { data: [{ id: 'notif-slow' }], error: null },
          },
          ...dispatchSuccessQueries('notif-slow'),
        ],
        jest.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 45));
          return { ok: true, providerMessageId: 'msg-slow' };
        }),
        true,
        async (fnName, params) => {
          if (fnName === 'acquire_or_renew_worker_lease') {
            renewCalls += 1;
            store.advanceMs(10_000);
          }
          return store.rpcHandler(fnName, params);
        },
      );

      const processed = await f.service.processPendingQueue(20, 12);
      expect(processed).toBe(1);
      expect(renewCalls).toBeGreaterThanOrEqual(2);
      expect(store.getLease()?.holder_id).toBe(f.service.getWorkerId());
    });

    it('releases the lease on graceful shutdown only if held by the current instance', async () => {
      const store = createSimulatedLeaseStore();
      const holder = serviceFixture(
        [
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
          { table: 'notifications', response: { data: [], error: null } },
        ],
        undefined,
        true,
        store.rpcHandler,
      );
      const nonHolder = serviceFixture([], undefined, true, store.rpcHandler);

      await holder.service.processPendingQueue();
      expect(store.getLease()?.holder_id).toBe(holder.service.getWorkerId());

      // Non-holder shutdown must not release holder's lease
      nonHolder.service.onModuleDestroy();
      expect(store.getLease()?.holder_id).toBe(holder.service.getWorkerId());

      // Holder shutdown releases its own lease
      holder.service.onModuleDestroy();
      await Promise.resolve();
      expect(store.getLease()).toBeNull();
    });

    it('keeps event-driven dispatch active on all 4 instances even when only 1 holds the recovery lease', async () => {
      const store = createSimulatedLeaseStore();
      const handlers: Array<(id: string) => Promise<unknown>> = [];
      const dispatchers = Array.from({ length: 4 }, (_, index) => {
        const db = databaseFixture(
          index === 0
            ? [
                { table: 'notifications', response: { data: [], error: null } },
                { table: 'notifications', response: { data: [], error: null } },
                { table: 'notifications', response: { data: [], error: null } },
              ]
            : dispatchSuccessQueries(`n-${index}`),
          store.rpcHandler,
        );
        const send = jest.fn().mockResolvedValue({
          ok: true,
          providerMessageId: `msg-${index}`,
        });
        const setNotificationDispatcher = jest.fn((fn) => handlers.push(fn));
        const dispatcher = new NotificationDispatcher(
          { admin: db.db, setNotificationDispatcher } as any,
          { configured: true, send },
        );
        dispatcher.onModuleInit();
        return { dispatcher, db, send };
      });

      try {
        await dispatchers[0].dispatcher.processPendingQueue();
        expect(store.getLease()?.holder_id).toBe(
          dispatchers[0].dispatcher.getWorkerId(),
        );

        // Non-lease-holder instance 2 still dispatches immediately via event-driven hook
        const res = (await handlers[2]('n-2')) as any;
        expect(res.dispatched).toBe(true);
        expect(dispatchers[2].send).toHaveBeenCalledTimes(1);
      } finally {
        for (const item of dispatchers) {
          item.dispatcher.onModuleDestroy();
        }
      }
    });

    it('logs sanitized lease_rpc_error with errorCode on PostgreSQL 42702 error', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const f = serviceFixture([], undefined, true, async () => ({
          data: null,
          error: {
            code: '42702',
            message: 'column reference "lease_name" is ambiguous',
          },
        }));

        await expect(f.service.processPendingQueue()).resolves.toBe(0);
        expect(f.calls).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_LEASE_RESULT]',
          expect.objectContaining({
            phase: 'acquire',
            workerId: f.service.getWorkerId(),
            leaseName: 'notification_queue_sweep',
            acquired: false,
            reason: 'lease_rpc_error',
            errorCode: '42702',
            errorMessage: 'column reference "lease_name" is ambiguous',
          }),
        );
        expect(logSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_QUEUE_SWEEP_SKIPPED]',
          expect.objectContaining({
            workerId: f.service.getWorkerId(),
            leaseName: 'notification_queue_sweep',
            reason: 'lease_rpc_error',
          }),
        );
      } finally {
        warnSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('logs sanitized lease_rpc_error with errorCode 42501 on permission-denied RPC error', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const f = serviceFixture([], undefined, true, async () => ({
          data: null,
          error: {
            code: '42501',
            message: 'permission denied for function acquire_or_renew_worker_lease',
          },
        }));

        await expect(f.service.processPendingQueue()).resolves.toBe(0);
        expect(f.calls).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_LEASE_RESULT]',
          expect.objectContaining({
            phase: 'acquire',
            acquired: false,
            reason: 'lease_rpc_error',
            errorCode: '42501',
          }),
        );
        expect(logSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_QUEUE_SWEEP_SKIPPED]',
          expect.objectContaining({
            reason: 'lease_rpc_error',
          }),
        );
      } finally {
        warnSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('logs lease_rpc_error on network exception and distinguishes it from normal lease contention', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const netErr = Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        });
        const networkFail = serviceFixture([], undefined, true, async () => {
          throw netErr;
        });

        await expect(networkFail.service.processPendingQueue()).resolves.toBe(0);
        expect(warnSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_LEASE_RESULT]',
          expect.objectContaining({
            reason: 'lease_rpc_error',
            errorCode: 'ECONNREFUSED',
            errorMessage: 'connect ECONNREFUSED',
          }),
        );
        expect(logSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_QUEUE_SWEEP_SKIPPED]',
          expect.objectContaining({
            reason: 'lease_rpc_error',
          }),
        );

        logSpy.mockClear();
        const contested = serviceFixture([], undefined, true, async () => ({
          data: [
            {
              lease_name: 'notification_queue_sweep',
              holder_id: '00000000-0000-0000-0000-000000000001',
              leased_until: '2026-11-26T12:00:00.000Z',
              acquired: false,
            },
          ],
          error: null,
        }));

        await expect(contested.service.processPendingQueue()).resolves.toBe(0);
        expect(contested.calls).toHaveLength(0);
        expect(logSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_LEASE_RESULT]',
          expect.objectContaining({
            acquired: false,
            reason: 'lease_not_acquired',
            returnedHolderId: '00000000-0000-0000-0000-000000000001',
            returnedAcquired: false,
          }),
        );
        expect(logSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_QUEUE_SWEEP_SKIPPED]',
          expect.objectContaining({
            reason: 'lease_not_acquired',
          }),
        );
      } finally {
        warnSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('rejects lease ownership if returned holder_id does not match current workerId', async () => {
      const f = serviceFixture([], undefined, true, async () => ({
        data: [
          {
            lease_name: 'notification_queue_sweep',
            holder_id: '11111111-1111-1111-1111-111111111111',
            leased_until: '2026-11-26T12:00:00.000Z',
            acquired: true,
          },
        ],
        error: null,
      }));

      await expect(f.service.acquireOrRenewLease('acquire')).resolves.toBe(false);
      await expect(f.service.processPendingQueue()).resolves.toBe(0);
      expect(f.calls).toHaveLength(0);
    });
  });

  describe('stale processing lifecycle recovery and exception safety', () => {
    it('ignores fresh processing records younger than 10 minutes', async () => {
      const freshStartedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const f = serviceFixture([
        {
          table: 'notifications',
          response: {
            data: [
              {
                id: 'fresh-processing',
                created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
                processing_started_at: freshStartedAt,
              },
            ],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: [], error: null },
        },
      ]);

      const recovered = await f.service.recoverStaleProcessing();
      expect(recovered).toBe(0);
      expect(f.send).not.toHaveBeenCalled();
      expect(f.remaining).toEqual([]);
    });

    it('reconciles stale processing with confirmed successful attempt without re-sending', async () => {
      const staleStartedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const f = serviceFixture([
        {
          table: 'notifications',
          response: {
            data: [
              {
                id: 'already-sent-id',
                created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
                processing_started_at: staleStartedAt,
              },
            ],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: {
            data: [
              {
                notification_id: 'already-sent-id',
                attempt_number: 1,
                status: 'sent',
                provider_response: { sentCount: 1 },
              },
            ],
            error: null,
          },
        },
        {
          table: 'notifications',
          response: { data: { id: 'already-sent-id' }, error: null },
        },
      ]);

      const recovered = await f.service.recoverStaleProcessing();
      expect(recovered).toBe(1);
      expect(f.send).not.toHaveBeenCalled();
      expect(f.remaining).toEqual([]);

      const updateCall = f.calls[2];
      expect(updateCall.methods).toContainEqual({
        name: 'update',
        arguments: [{ status: 'sent', processing_started_at: null }],
      });
      expect(updateCall.methods).toContainEqual({
        name: 'eq',
        arguments: ['processing_started_at', staleStartedAt],
      });
    });

    it('marks historical stale processing records older than 24 hours as failed without sending or synthetic attempts', async () => {
      const oldCreatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const staleStartedAt = new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString();
      const f = serviceFixture([
        {
          table: 'notifications',
          response: {
            data: [
              {
                id: 'oct-historical-id',
                created_at: oldCreatedAt,
                processing_started_at: staleStartedAt,
              },
            ],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: [], error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: 'oct-historical-id' }, error: null },
        },
      ]);

      const recovered = await f.service.recoverStaleProcessing();
      expect(recovered).toBe(1);
      expect(f.send).not.toHaveBeenCalled();
      expect(f.remaining).toEqual([]);
      expect(f.calls).toHaveLength(3); // No synthetic attempt insert

      expect(f.calls[2].methods).toContainEqual({
        name: 'update',
        arguments: [{ status: 'failed', processing_started_at: null }],
      });
    });

    it('respects maximum attempt count (3) and marks stale processing as failed without synthetic attempts', async () => {
      const staleStartedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const f = serviceFixture([
        {
          table: 'notifications',
          response: {
            data: [
              {
                id: 'max-attempt-stale',
                created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
                processing_started_at: staleStartedAt,
              },
            ],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: {
            data: [
              {
                notification_id: 'max-attempt-stale',
                attempt_number: 3,
                status: 'failed',
                provider_response: { reason: 'transient' },
              },
            ],
            error: null,
          },
        },
        {
          table: 'notifications',
          response: { data: { id: 'max-attempt-stale' }, error: null },
        },
      ]);

      const recovered = await f.service.recoverStaleProcessing();
      expect(recovered).toBe(1);
      expect(f.send).not.toHaveBeenCalled();
      expect(f.calls).toHaveLength(3); // No synthetic attempt insert
      expect(f.calls[2].methods).toContainEqual({
        name: 'update',
        arguments: [{ status: 'failed', processing_started_at: null }],
      });
    });

    it('recovers recent stale processing records safely for one controlled retry without synthetic attempts', async () => {
      const staleStartedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const f = serviceFixture([
        {
          table: 'notifications',
          response: {
            data: [
              {
                id: 'recent-stale-id',
                created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
                processing_started_at: staleStartedAt,
              },
            ],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: [], error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: 'recent-stale-id' }, error: null },
        },
      ]);

      const recovered = await f.service.recoverStaleProcessing();
      expect(recovered).toBe(1);
      expect(f.calls).toHaveLength(3); // No synthetic attempt insert
      expect(f.calls[2].methods).toContainEqual({
        name: 'update',
        arguments: [{ status: 'failed', processing_started_at: null }],
      });
    });

    it('ignores legacy processing records with NULL processing_started_at', async () => {
      const f = serviceFixture([
        {
          table: 'notifications',
          response: {
            data: [
              {
                id: 'legacy-null-ts',
                created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
                processing_started_at: null,
              },
            ],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: [], error: null },
        },
      ]);

      const recovered = await f.service.recoverStaleProcessing();
      expect(recovered).toBe(0);
      expect(f.calls).toHaveLength(2);
      expect(f.remaining).toEqual([]);
    });

    it('stops stale-processing recovery immediately when lease is lost', async () => {
      const staleStartedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      let callsAllowed = 1;
      const f = serviceFixture([
        {
          table: 'notifications',
          response: {
            data: [
              {
                id: 'stale-1',
                created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
                processing_started_at: staleStartedAt,
              },
              {
                id: 'stale-2',
                created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
                processing_started_at: staleStartedAt,
              },
            ],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: [], error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: 'stale-1' }, error: null },
        },
      ]);

      const recovered = await f.service.recoverStaleProcessing(20, () => {
        if (callsAllowed > 0) {
          callsAllowed -= 1;
          return true;
        }
        return false;
      });

      expect(recovered).toBe(1);
      expect(f.remaining).toEqual([]);
      expect(f.calls).toHaveLength(3);
    });

    it('prevents Worker A from overwriting Worker B newer claim on finish()', async () => {
      const workerAClaimToken = '2026-11-26T06:00:00.000000+00:00';
      const f = serviceFixture([
        { table: 'notifications', response: { data: notification, error: null } },
        {
          table: 'notifications',
          response: {
            data: {
              ...notification,
              status: 'processing',
              processing_started_at: workerAClaimToken,
            },
            error: null,
          },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        {
          table: 'device_tokens',
          response: { data: [{ id: 'dev-1', push_token: 'tok-1' }], error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        // Worker B already holds a newer processing_started_at, so Worker A's fenced update matches 0 rows
        { table: 'notifications', response: { data: null, error: null } },
      ]);

      const res = await f.service.dispatchPersisted(notification.id);
      expect(res.dispatched).toBe(false);
      expect(res.reason).toBe('stale_claim');
      expect(f.remaining).toEqual([]);

      const finishUpdate = f.calls[6];
      expect(finishUpdate.methods).toContainEqual({
        name: 'eq',
        arguments: ['status', 'processing'],
      });
      expect(finishUpdate.methods).toContainEqual({
        name: 'eq',
        arguments: ['processing_started_at', workerAClaimToken],
      });
    });

    it('prevents Worker A from reconciling an exception against Worker B newer claim', async () => {
      const workerAClaimToken = '2026-11-26T06:00:00.000000+00:00';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const f = serviceFixture([
          { table: 'notifications', response: { data: notification, error: null } },
          {
            table: 'notifications',
            response: {
              data: {
                ...notification,
                status: 'processing',
                processing_started_at: workerAClaimToken,
              },
              error: null,
            },
          },
          {
            table: 'notification_preferences',
            response: { data: { push_enabled: true }, error: null },
          },
          {
            table: 'device_tokens',
            response: { data: [{ id: 'dev-1', push_token: 'tok-1' }], error: null },
          },
          // finish() attempt insert fails after FCM succeeded
          {
            table: 'notification_delivery_attempts',
            response: { data: null, error: null },
          },
          {
            table: 'notification_delivery_attempts',
            response: { data: null, error: { message: 'insert failed' } },
          },
          // reconcileClaimedNotificationOnError checks attempts, then fenced update matches 0 rows (Worker B owns newer claim)
          {
            table: 'notification_delivery_attempts',
            response: { data: [], error: null },
          },
          { table: 'notifications', response: { data: null, error: null } },
        ]);

        await expect(f.service.dispatchPersisted(notification.id)).rejects.toThrow(
          'Unable to record notification attempt',
        );
        expect(f.remaining).toEqual([]);
        expect(f.calls[7].methods).toContainEqual({
          name: 'eq',
          arguments: ['processing_started_at', workerAClaimToken],
        });
        expect(warnSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_DISPATCH_RECONCILE_STALE_CLAIM]',
          expect.objectContaining({
            notificationId: notification.id,
            targetStatus: 'sent',
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('reconciles safely to sent when FCM succeeds but notification status update fails', async () => {
      const f = serviceFixture([
        { table: 'notifications', response: { data: notification, error: null } },
        {
          table: 'notifications',
          response: { data: { ...notification, status: 'processing' }, error: null },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        {
          table: 'device_tokens',
          response: { data: [{ id: 'dev-1', push_token: 'tok-1' }], error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        // notifications status update throws error
        {
          table: 'notifications',
          response: { data: null, error: { message: 'status update timeout' } },
        },
        // reconcileClaimedNotificationOnError reads attempts (sees sent) and retries fenced update -> sent
        {
          table: 'notification_delivery_attempts',
          response: {
            data: [{ status: 'sent', attempt_number: 1 }],
            error: null,
          },
        },
        {
          table: 'notifications',
          response: { data: { id: notification.id }, error: null },
        },
      ]);

      await expect(f.service.dispatchPersisted(notification.id)).rejects.toThrow(
        'Unable to update notification status',
      );
      expect(f.remaining).toEqual([]);
      expect(f.calls[8].methods).toContainEqual({
        name: 'update',
        arguments: [{ status: 'sent', processing_started_at: null }],
      });
    });

    it('prevents two workers or a racing reaper/dispatcher from recovering the same notification twice', async () => {
      const staleStartedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      // Worker 2 / racing reaper gets null on conditional update because status/processing_started_at already changed
      const racingReaper = serviceFixture([
        {
          table: 'notifications',
          response: {
            data: [
              {
                id: 'race-notif-id',
                created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
                processing_started_at: staleStartedAt,
              },
            ],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: [], error: null },
        },
        {
          table: 'notifications',
          response: { data: null, error: null }, // conditional match failed (already recovered or re-claimed with newer processing_started_at)
        },
      ]);

      const recovered = await racingReaper.service.recoverStaleProcessing();
      expect(recovered).toBe(0);
      expect(racingReaper.remaining).toEqual([]);
      // Must NOT insert a duplicate attempt when conditional update matched 0 rows
      expect(racingReaper.calls).toHaveLength(3);
    });

    it('reconciles to sent without duplicate push when finish() fails after FCM accepted delivery', async () => {
      const f = serviceFixture([
        { table: 'notifications', response: { data: notification, error: null } },
        {
          table: 'notifications',
          response: { data: { ...notification, status: 'processing' }, error: null },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        {
          table: 'device_tokens',
          response: { data: [{ id: 'dev-1', push_token: 'tok-1' }], error: null },
        },
        // finish() attempt read throws error
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: { message: 'transient db write error' } },
        },
        // reconcileClaimedNotificationOnError reads attempts and updates notifications -> sent
        {
          table: 'notification_delivery_attempts',
          response: { data: [], error: null },
        },
        { table: 'notifications', response: { data: null, error: null } },
      ]);

      await expect(f.service.dispatchPersisted(notification.id)).rejects.toThrow(
        'Unable to inspect notification attempts',
      );
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.remaining).toEqual([]);

      const reconcileUpdate = f.calls[6];
      expect(reconcileUpdate.methods).toContainEqual({
        name: 'update',
        arguments: [{ status: 'sent', processing_started_at: null }],
      });
    });

    it('reconciles to failed (never queued) when an exception occurs before any FCM send succeeds', async () => {
      const f = serviceFixture(
        [
          { table: 'notifications', response: { data: notification, error: null } },
          {
            table: 'notifications',
            response: { data: { ...notification, status: 'processing' }, error: null },
          },
          {
            table: 'notification_preferences',
            response: { data: { push_enabled: true }, error: null },
          },
          {
            table: 'device_tokens',
            response: { data: [{ id: 'dev-1', push_token: 'tok-1' }], error: null },
          },
          // finish() fails when recording failed attempt
          {
            table: 'notification_delivery_attempts',
            response: { data: null, error: { message: 'db timeout' } },
          },
          // reconcileClaimedNotificationOnError
          {
            table: 'notification_delivery_attempts',
            response: { data: [], error: null },
          },
          { table: 'notifications', response: { data: null, error: null } },
        ],
        jest.fn().mockResolvedValue({ ok: false, reason: 'provider_error' }),
      );

      await expect(f.service.dispatchPersisted(notification.id)).rejects.toThrow(
        'Unable to inspect notification attempts',
      );
      expect(f.remaining).toEqual([]);
      expect(f.calls[6].methods).toContainEqual({
        name: 'update',
        arguments: [{ status: 'failed', processing_started_at: null }],
      });
    });

    it('sets processing_started_at on claim and clears it on terminal transitions', async () => {
      const f = serviceFixture([
        { table: 'notifications', response: { data: notification, error: null } },
        {
          table: 'notifications',
          response: { data: { ...notification, status: 'processing' }, error: null },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: false }, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: notification.id }, error: null },
        },
      ]);

      const result = await f.service.dispatchPersisted(notification.id);
      expect(result.status).toBe('cancelled');
      expect(f.remaining).toEqual([]);

      const claimUpdate = f.calls[1].methods.find((m) => m.name === 'update')
        ?.arguments[0] as any;
      expect(claimUpdate.status).toBe('processing');
      expect(typeof claimUpdate.processing_started_at).toBe('string');

      const finalUpdate = f.calls[5].methods.find((m) => m.name === 'update')
        ?.arguments[0] as any;
      expect(finalUpdate).toEqual({
        status: 'cancelled',
        processing_started_at: null,
      });
    });
  });

  describe('in_app and FCM delivery decoupling', () => {
    const inAppNotification = {
      ...notification,
      id: 'in-app-notif-id',
      channel: 'in_app' as const,
      event_type: 'order_created',
    };

    const pushNotification = {
      ...notification,
      id: 'push-notif-id',
      channel: 'push' as const,
      event_type: 'order_created',
    };

    it('marks in_app notification sent when recipient has no active devices without synthetic delivery attempts', async () => {
      const claimToken = '2026-11-26T08:00:00.000000+00:00';
      const f = serviceFixture([
        {
          table: 'notifications',
          response: { data: inAppNotification, error: null },
        },
        {
          table: 'notifications',
          response: {
            data: {
              ...inAppNotification,
              status: 'processing',
              processing_started_at: claimToken,
            },
            error: null,
          },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        { table: 'device_tokens', response: { data: [], error: null } },
        {
          table: 'notifications',
          response: { data: { id: inAppNotification.id }, error: null },
        },
      ]);

      const result = await f.service.dispatchPersisted(inAppNotification.id);
      expect(result).toEqual({
        notificationId: inAppNotification.id,
        dispatched: true,
        status: 'sent',
        attemptedDeviceCount: 0,
        sentCount: 0,
        failedCount: 0,
        reason: 'no_active_devices',
      });
      expect(f.send).not.toHaveBeenCalled();
      expect(f.calls.filter((c) => c.table === 'notification_delivery_attempts')).toHaveLength(0);
      expect(f.calls[4].methods).toContainEqual({
        name: 'update',
        arguments: [{ status: 'sent', processing_started_at: null }],
      });
      expect(f.calls[4].methods).toContainEqual({
        name: 'eq',
        arguments: ['processing_started_at', claimToken],
      });
      expect(f.remaining).toEqual([]);
    });

    it('marks in_app notification sent when push is disabled without contacting FCM or inserting synthetic attempts', async () => {
      const f = serviceFixture([
        {
          table: 'notifications',
          response: { data: inAppNotification, error: null },
        },
        {
          table: 'notifications',
          response: {
            data: { ...inAppNotification, status: 'processing' },
            error: null,
          },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: false }, error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: inAppNotification.id }, error: null },
        },
      ]);

      const result = await f.service.dispatchPersisted(inAppNotification.id);
      expect(result.status).toBe('sent');
      expect(result.reason).toBe('push_disabled');
      expect(f.send).not.toHaveBeenCalled();
      expect(f.calls.filter((c) => c.table === 'notification_delivery_attempts')).toHaveLength(0);
      expect(f.remaining).toEqual([]);
    });

    it('marks in_app notification sent when FCM provider is unavailable without synthetic attempts', async () => {
      const f = serviceFixture(
        [
          {
            table: 'notifications',
            response: { data: inAppNotification, error: null },
          },
          {
            table: 'notifications',
            response: {
              data: { ...inAppNotification, status: 'processing' },
              error: null,
            },
          },
          {
            table: 'notifications',
            response: { data: { id: inAppNotification.id }, error: null },
          },
        ],
        jest.fn(),
        false,
      );

      const result = await f.service.dispatchPersisted(inAppNotification.id);
      expect(result.status).toBe('sent');
      expect(result.reason).toBe('provider_not_configured');
      expect(f.send).not.toHaveBeenCalled();
      expect(f.calls.filter((c) => c.table === 'notification_delivery_attempts')).toHaveLength(0);
      expect(f.remaining).toEqual([]);
    });

    it('marks in_app notification sent and records real sent attempt when FCM succeeds', async () => {
      const f = serviceFixture([
        {
          table: 'notifications',
          response: { data: inAppNotification, error: null },
        },
        {
          table: 'notifications',
          response: {
            data: { ...inAppNotification, status: 'processing' },
            error: null,
          },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        {
          table: 'device_tokens',
          response: {
            data: [{ id: 'dev-1', push_token: 'tok-1' }],
            error: null,
          },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: inAppNotification.id }, error: null },
        },
      ]);

      const result = await f.service.dispatchPersisted(inAppNotification.id);
      expect(result).toMatchObject({
        notificationId: inAppNotification.id,
        dispatched: true,
        status: 'sent',
        sentCount: 1,
        failedCount: 0,
      });
      expect(f.send).toHaveBeenCalledTimes(1);
      const attemptInsert = f.calls[5].methods.find((m) => m.name === 'insert')
        ?.arguments[0] as any;
      expect(attemptInsert.status).toBe('sent');
      expect(f.remaining).toEqual([]);
    });

    it('keeps in_app notification sent when optional FCM push fails while recording failed push attempt and diagnostics', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const f = serviceFixture(
          [
            {
              table: 'notifications',
              response: { data: inAppNotification, error: null },
            },
            {
              table: 'notifications',
              response: {
                data: { ...inAppNotification, status: 'processing' },
                error: null,
              },
            },
            {
              table: 'notification_preferences',
              response: { data: { push_enabled: true }, error: null },
            },
            {
              table: 'device_tokens',
              response: {
                data: [{ id: 'dev-1', push_token: 'tok-1' }],
                error: null,
              },
            },
            {
              table: 'notification_delivery_attempts',
              response: { data: null, error: null },
            },
            {
              table: 'notification_delivery_attempts',
              response: { data: null, error: null },
            },
            {
              table: 'notifications',
              response: { data: { id: inAppNotification.id }, error: null },
            },
          ],
          jest.fn().mockResolvedValue({ ok: false, reason: 'provider_error' }),
        );

        const result = await f.service.dispatchPersisted(inAppNotification.id);
        expect(result).toMatchObject({
          notificationId: inAppNotification.id,
          dispatched: true,
          status: 'sent',
          sentCount: 0,
          failedCount: 1,
          reason: 'push_delivery_failed',
        });

        // Real delivery attempt records actual failed FCM outcome
        const attemptInsert = f.calls[5].methods.find((m) => m.name === 'insert')
          ?.arguments[0] as any;
        expect(attemptInsert.status).toBe('failed');
        expect(attemptInsert.provider_response.reason).toBe('push_delivery_failed');

        // Persisted inbox notification row transitions to sent with cleared processing_started_at
        expect(f.calls[6].methods).toContainEqual({
          name: 'update',
          arguments: [{ status: 'sent', processing_started_at: null }],
        });
        expect(warnSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_IN_APP_PUSH_FAILED]',
          expect.objectContaining({
            notificationId: inAppNotification.id,
            channel: 'in_app',
            eventType: 'order_created',
          }),
        );
        expect(f.remaining).toEqual([]);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('preserves failed status for push channel when no active devices exist or FCM fails', async () => {
      const noDevices = serviceFixture([
        {
          table: 'notifications',
          response: { data: pushNotification, error: null },
        },
        {
          table: 'notifications',
          response: {
            data: { ...pushNotification, status: 'processing' },
            error: null,
          },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: true }, error: null },
        },
        { table: 'device_tokens', response: { data: [], error: null } },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notification_delivery_attempts',
          response: { data: null, error: null },
        },
        {
          table: 'notifications',
          response: { data: { id: pushNotification.id }, error: null },
        },
      ]);

      await expect(
        noDevices.service.dispatchPersisted(pushNotification.id),
      ).resolves.toMatchObject({
        status: 'failed',
        reason: 'no_active_devices',
      });

      const fcmFail = serviceFixture(
        [
          {
            table: 'notifications',
            response: { data: pushNotification, error: null },
          },
          {
            table: 'notifications',
            response: {
              data: { ...pushNotification, status: 'processing' },
              error: null,
            },
          },
          {
            table: 'notification_preferences',
            response: { data: { push_enabled: true }, error: null },
          },
          {
            table: 'device_tokens',
            response: {
              data: [{ id: 'dev-1', push_token: 'tok-1' }],
              error: null,
            },
          },
          {
            table: 'notification_delivery_attempts',
            response: { data: null, error: null },
          },
          {
            table: 'notification_delivery_attempts',
            response: { data: null, error: null },
          },
          {
            table: 'notifications',
            response: { data: { id: pushNotification.id }, error: null },
          },
        ],
        jest.fn().mockResolvedValue({ ok: false, reason: 'provider_error' }),
      );

      await expect(
        fcmFail.service.dispatchPersisted(pushNotification.id),
      ).resolves.toMatchObject({
        status: 'failed',
        failedCount: 1,
      });
    });

    it('logs sanitized structured DB error diagnostics when delivery-attempt insertion fails', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const f = serviceFixture([
          {
            table: 'notifications',
            response: { data: inAppNotification, error: null },
          },
          {
            table: 'notifications',
            response: {
              data: { ...inAppNotification, status: 'processing' },
              error: null,
            },
          },
          {
            table: 'notification_preferences',
            response: { data: { push_enabled: true }, error: null },
          },
          {
            table: 'device_tokens',
            response: {
              data: [{ id: 'dev-1', push_token: 'tok-1' }],
              error: null,
            },
          },
          {
            table: 'notification_delivery_attempts',
            response: { data: null, error: null },
          },
          {
            table: 'notification_delivery_attempts',
            response: {
              data: null,
              error: { code: '42501', message: 'permission denied for table' },
            },
          },
          // reconcileClaimedNotificationOnError
          {
            table: 'notification_delivery_attempts',
            response: { data: [], error: null },
          },
          {
            table: 'notifications',
            response: { data: { id: inAppNotification.id }, error: null },
          },
        ]);

        await expect(
          f.service.dispatchPersisted(inAppNotification.id),
        ).rejects.toThrow('Unable to record notification attempt');

        expect(warnSpy).toHaveBeenCalledWith(
          '[NOTIFICATION_DB_ERROR]',
          expect.objectContaining({
            notificationId: inAppNotification.id,
            channel: 'in_app',
            eventType: 'order_created',
            stage: 'insert_attempt',
            errorCode: '42501',
            errorMessage: 'permission denied for table',
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('enforces claim fencing when finalizing an in_app notification without provider attempt', async () => {
      const staleClaimToken = '2026-11-26T08:00:00.000000+00:00';
      const f = serviceFixture([
        {
          table: 'notifications',
          response: { data: inAppNotification, error: null },
        },
        {
          table: 'notifications',
          response: {
            data: {
              ...inAppNotification,
              status: 'processing',
              processing_started_at: staleClaimToken,
            },
            error: null,
          },
        },
        {
          table: 'notification_preferences',
          response: { data: { push_enabled: false }, error: null },
        },
        // 0 rows matched because a newer worker holds the claim
        { table: 'notifications', response: { data: null, error: null } },
      ]);

      const result = await f.service.dispatchPersisted(inAppNotification.id);
      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe('stale_claim');
      expect(f.calls[3].methods).toContainEqual({
        name: 'eq',
        arguments: ['processing_started_at', staleClaimToken],
      });
    });
  });
});

import {BadRequestException, ConflictException, NotFoundException} from '@nestjs/common';
import {AdminIssuesService} from './admin-issues.service';

function fixture(rows: Record<string, any> = {}) {
  const rpc = jest.fn().mockResolvedValue({data: {id: 'result'}, error: null});
  const broadcastEvent = jest.fn().mockResolvedValue(true);
  const insert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({data: {id: 'new-row', status: 'approved'}, error: null}),
      maybeSingle: jest.fn().mockResolvedValue({data: {id: 'new-row', status: 'approved'}, error: null}),
    }),
  });
  const update = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({data: {id: 'r1', status: 'approved'}, error: null}),
      }),
    }),
  });
  const maybeSingle = jest.fn().mockImplementation(() => Promise.resolve({data: rows.claim ?? {id: 'c1', order_id: 'o1', status: 'under_review'}, error: null}));
  const single = jest.fn().mockImplementation(() => Promise.resolve({data: rows.claim ?? {id: 'c1', order_id: 'o1', total_amount: 100}, error: null}));
  const like = jest.fn().mockReturnValue(Promise.resolve({data: rows.existingRefunds ?? [], error: null}));
  const eq = jest.fn().mockReturnValue({eq: jest.fn().mockReturnValue({maybeSingle}), maybeSingle, single, like});
  const order = jest.fn().mockReturnValue({limit: jest.fn().mockResolvedValue({data: rows.overviewData ?? [], error: null})});
  const from = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({eq, order, maybeSingle, like}),
    insert,
    update,
  });
  const payments = {approveRefund: jest.fn().mockResolvedValue({id: 'r1', status: 'completed'})};
  const supabase = {admin: {from, rpc}, broadcastEvent};
  return {service: new AdminIssuesService(supabase as any, payments as any), rpc, broadcastEvent, payments, from, maybeSingle, update, insert};
}

describe('9F Admin issues', () => {
  it('scopes claim decisions to the order and passes actor to atomic procedure', async () => {
    const {service, rpc} = fixture();
    await service.claimDecision('admin', 'o1', 'c1', 'under_review', 'Photograph reviewed');
    expect(rpc).toHaveBeenCalledWith('admin_review_customer_claim_atomic', {p_claim_id: 'c1', p_admin_id: 'admin', p_target_status: 'under_review', p_notes: 'Photograph reviewed'});
  });

  it('rejects a wrong-order claim before a decision', async () => {
    const {service, rpc, maybeSingle} = fixture();
    maybeSingle.mockResolvedValueOnce({data: null, error: null});
    await expect(service.claimDecision('admin', 'wrong', 'c1', 'rejected', 'Wrong order')).rejects.toBeInstanceOf(NotFoundException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks invalid refund amounts and non-mock Development payment', async () => {
    const {service, maybeSingle} = fixture();
    maybeSingle.mockResolvedValue({data: {id: 'p1', provider: 'mock'}, error: null});
    await expect(service.requestRefund('admin', 'o1', 'p1', -1, 'Reason')).rejects.toBeInstanceOf(BadRequestException);
    maybeSingle.mockResolvedValue({data: {id: 'p1', provider: 'other'}, error: null});
    await expect(service.requestRefund('admin', 'o1', 'p1', 10, 'Reason')).rejects.toBeInstanceOf(ConflictException);
  });

  it('passes scoped mock payment and notes to audited refund request', async () => {
    const {service, rpc, maybeSingle} = fixture();
    maybeSingle.mockResolvedValue({data: {id: 'p1', provider: 'mock'}, error: null});
    await service.requestRefund('admin', 'o1', 'p1', 10, 'Customer issue');
    expect(rpc).toHaveBeenCalledWith('admin_request_order_refund_atomic', {p_order_id: 'o1', p_payment_order_id: 'p1', p_admin_id: 'admin', p_amount: 10, p_reason: 'Customer issue'});
  });

  it('overview maps refund order_id correctly from payment_transactions or payment_orders', async () => {
    const {service, from} = fixture();
    from.mockImplementation((table: string) => {
      if (table === 'refund_requests') {
        return {
          select: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'r-cod',
                    amount: 150,
                    status: 'approved',
                    payment_orders: null,
                    payment_transactions: {order_id: 'order-cod-1'},
                  },
                  {
                    id: 'r-online',
                    amount: 250,
                    status: 'approved',
                    payment_orders: {order_id: 'order-online-2'},
                    payment_transactions: null,
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({data: [], error: null}),
          }),
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({data: [], error: null}),
            }),
          }),
        }),
      };
    });

    const result = await service.overview();
    expect(result.refunds).toHaveLength(2);
    expect(result.refunds[0].order_id).toBe('order-cod-1');
    expect(result.refunds[0].payment_orders?.order_id).toBe('order-cod-1');
    expect(result.refunds[1].order_id).toBe('order-online-2');
  });

  it('separates refund approval from payment execution without calling provider immediately', async () => {
    const {service, payments, update, from} = fixture();
    from.mockImplementation((table: string) => {
      if (table === 'refund_requests') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: {id: 'r1', payment_order_id: 'p1', amount: 50, status: 'requested'},
                error: null,
              }),
            }),
          }),
          update,
        };
      }
      if (table === 'payment_orders') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {id: 'p1', order_id: 'o1', provider: 'razorpay', status: 'paid'},
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {insert: jest.fn().mockResolvedValue({data: {}, error: null})};
    });

    const result = await service.approveRefund('admin-user', 'o1', 'r1', 'Approved by lead');
    expect(result.status).toBe('approved');
    expect(payments.approveRefund).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'approved',
      approved_by: 'admin-user',
    }));
  });

  it('executes COD refund by completing directly without external provider call', async () => {
    const {service, payments, from} = fixture();
    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {id: 'r-cod', status: 'completed'},
            error: null,
          }),
        }),
      }),
    });

    from.mockImplementation((table: string) => {
      if (table === 'refund_requests') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: {id: 'r-cod', payment_order_id: null, payment_transaction_id: 'tx-1', amount: 80, status: 'approved'},
                error: null,
              }),
            }),
          }),
          update: updateMock,
        };
      }
      if (table === 'payment_transactions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: {id: 'tx-1', order_id: 'o1'},
                error: null,
              }),
            }),
          }),
        };
      }
      return {insert: jest.fn().mockResolvedValue({data: {}, error: null})};
    });

    const result = await service.executeRefund('admin-user', 'o1', 'r-cod', 'Handed cash');
    expect(result.status).toBe('completed');
    expect(payments.approveRefund).not.toHaveBeenCalled();
  });

  it('claim decision automatically triggers refund creation when notes indicate COD reimbursement', async () => {
    const {service, rpc, from} = fixture();
    const insertMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({
          data: {id: 'new-cod-refund', amount: 100, status: 'approved'},
          error: null,
        }),
      }),
    });

    from.mockImplementation((table: string) => {
      if (table === 'refund_requests') {
        return {
          select: jest.fn().mockReturnValue({
            like: jest.fn().mockResolvedValue({data: [], error: null}),
          }),
          insert: insertMock,
        };
      }
      if (table === 'payment_orders') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({data: null, error: null}),
            }),
          }),
        };
      }
      if (table === 'payment_transactions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({data: {id: 'tx-1'}, error: null}),
            }),
          }),
        };
      }
      const maybeClaim = jest.fn().mockResolvedValue({data: {id: 'c1', order_id: 'o1'}, error: null});
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({maybeSingle: maybeClaim}),
            maybeSingle: maybeClaim,
          }),
        }),
        insert: jest.fn().mockResolvedValue({data: {}, error: null}),
      };
    });


    await service.claimDecision(
      'admin-1',
      'o1',
      'c1',
      'resolved',
      '[COD Manual Reimbursement - UPI] Amount: ₹100.00. Notes: Damaged garment reimbursement',
    );

    expect(rpc).toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      amount: 100,
      status: 'approved',
      approved_by: 'admin-1',
    }));
  });
});

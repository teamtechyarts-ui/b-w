import {BadRequestException, ConflictException, NotFoundException} from '@nestjs/common';
import {AdminIssuesService} from './admin-issues.service';

function fixture(rows: Record<string, any> = {}) {
  const rpc = jest.fn().mockResolvedValue({data: {id: 'result'}, error: null});
  const maybeSingle = jest.fn().mockImplementation(() => Promise.resolve({data: rows.claim ?? {id: 'c1'}, error: null}));
  const eq = jest.fn().mockReturnValue({eq: jest.fn().mockReturnValue({maybeSingle}), maybeSingle});
  const from = jest.fn().mockReturnValue({select: jest.fn().mockReturnValue({eq})});
  const payments = {approveRefund: jest.fn().mockResolvedValue({id: 'r1'})};
  return {service: new AdminIssuesService({admin: {from, rpc}} as any, payments as any), rpc, payments, from, maybeSingle};
}
describe('9F Admin issues', () => {
  it('scopes claim decisions to the order and passes actor to atomic procedure', async () => {
    const {service, rpc} = fixture();
    await service.claimDecision('admin', 'o1', 'c1', 'under_review', 'Photograph reviewed');
    expect(rpc).toHaveBeenCalledWith('admin_review_customer_claim_atomic', {p_claim_id: 'c1', p_admin_id: 'admin', p_target_status: 'under_review', p_notes: 'Photograph reviewed'});
  });
  it('rejects a wrong-order claim before a decision', async () => {
    const {service, rpc, maybeSingle} = fixture(); maybeSingle.mockResolvedValueOnce({data: null, error: null});
    await expect(service.claimDecision('admin', 'wrong', 'c1', 'rejected', 'Wrong order')).rejects.toBeInstanceOf(NotFoundException);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('blocks invalid refund amounts and non-mock Development payment', async () => {
    const {service, maybeSingle} = fixture(); maybeSingle.mockResolvedValue({data: {id: 'p1', provider: 'mock'}, error: null});
    await expect(service.requestRefund('admin', 'o1', 'p1', -1, 'Reason')).rejects.toBeInstanceOf(BadRequestException);
    maybeSingle.mockResolvedValue({data: {id: 'p1', provider: 'other'}, error: null});
    await expect(service.requestRefund('admin', 'o1', 'p1', 10, 'Reason')).rejects.toBeInstanceOf(ConflictException);
  });
  it('passes scoped mock payment and notes to audited refund request', async () => {
    const {service, rpc, maybeSingle} = fixture(); maybeSingle.mockResolvedValue({data: {id: 'p1', provider: 'mock'}, error: null});
    await service.requestRefund('admin', 'o1', 'p1', 10, 'Customer issue');
    expect(rpc).toHaveBeenCalledWith('admin_request_order_refund_atomic', {p_order_id: 'o1', p_payment_order_id: 'p1', p_admin_id: 'admin', p_amount: 10, p_reason: 'Customer issue'});
  });
});

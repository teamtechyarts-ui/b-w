import {apiRequest} from './api';

export type ProcessingStage = 'washing' | 'drying' | 'ironing' | 'folding' | 'packaging';
export type StageRecord = {id: string; operation_type: ProcessingStage; started_at: string;
  completed_at: string | null; started_by: string | null; completed_by: string | null; rewash_cycle: number};
export type QualityDecision = {id: string; cycle_number: number; approved: boolean; rewash_required: boolean;
  defect_code: string | null; reason: string | null; affected_item_ids: string[]; created_at: string};
export type ProcessingHistory = {orderId: string; orderStatus: string; stages: StageRecord[];
  activeOperationId: string | null; nextStage: ProcessingStage | null;
  openDiscrepancies: number; completedStageCount: number; qualityDecisions?: QualityDecision[];
  role?: 'manager' | 'facility_employee'; canQualityCheck?: boolean; rewashCycle?: number;
  packingRequired?: boolean; isPacked?: boolean; packingReady?: boolean};

export function getFacilityProcessing(accessToken: string, orderId: string) {
  return apiRequest<ProcessingHistory>(`/facility/orders/${encodeURIComponent(orderId)}/processing`, {accessToken});
}
export function startFacilityStage(accessToken: string, orderId: string, processType: ProcessingStage) {
  return apiRequest(`/facility/orders/${encodeURIComponent(orderId)}/processing`,
    {accessToken, method: 'POST', body: {processType}});
}
export function completeFacilityStage(accessToken: string, operationId: string) {
  return apiRequest(`/facility/operations/${encodeURIComponent(operationId)}/complete`,
    {accessToken, method: 'POST'});
}
export function recordFacilityQualityDecision(accessToken: string, orderId: string,
  decision: {approved: boolean; notes?: string; defectCode?: string; affectedItemIds?: string[]}) {
  return apiRequest(`/facility/orders/${encodeURIComponent(orderId)}/quality-check`,
    {accessToken, method: 'POST', body: decision});
}

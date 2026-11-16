/**
 * Boundary for future automatic PromptPay verification. The POS deliberately
 * ships only the manual provider: a QR is never marked paid by generation,
 * scanning or expiry.
 *
 * A future provider (merchant webhook, bank statement import, licensed slip
 * verification) implements this interface and writes through the same
 * payment_transactions/payment_sessions state machine with an idempotency key.
 */
export type PaymentVerificationMethod =
  | 'manual'
  | 'provider_webhook'
  | 'slip_verification'
  | 'statement_import';

export interface VerificationRequest {
  tenantId: string;
  sessionId: string;
  expectedAmountSatang: number;
  reference?: string;
}

export interface VerificationOutcome {
  verified: boolean;
  method: PaymentVerificationMethod;
  provider: string;
  providerRef?: string;
  receivedAmountSatang?: number;
  metadata?: Record<string, unknown>;
  reason?: string;
}

export interface PaymentVerificationProvider {
  readonly code: string;
  readonly automatic: boolean;
  verify(request: VerificationRequest): Promise<VerificationOutcome>;
}

/**
 * Manual provider used by staff confirmation. The actual mutation lives in the
 * PromptPay service so the staff identity and audit trail are mandatory.
 */
export const manualVerificationProvider: PaymentVerificationProvider = {
  code: 'manual',
  automatic: false,
  async verify() {
    return {
      verified: false,
      method: 'manual',
      provider: 'manual',
      reason: 'manual_confirmation_requires_staff_action',
    };
  },
};

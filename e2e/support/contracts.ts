export type InvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";

export interface Invoice {
  id: string;
  invoiceNumber: string | null;
  projectId: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: InvoiceStatus;
}

export interface DashboardSummary {
  revenue: {
    totalRevenue: number;
    paidAmount: number;
    outstandingBalance: number;
  };
  invoices: {
    totalInvoices: number;
    issuedCount: number;
    partiallyPaidCount: number;
    paidCount: number;
    overdueCount: number;
  };
}

export interface PaymentResult {
  payment: {
    id: string;
    invoiceId: string;
    referenceNumber: string;
    amount: number;
  };
  invoice: Pick<
    Invoice,
    "id" | "totalAmount" | "paidAmount" | "outstandingAmount" | "status"
  >;
}

export interface RiskPrediction {
  projectId: string;
  projectName: string;
  projectRiskLevel: "LOW" | "MEDIUM" | "HIGH";
  paymentDelayRisk: "LOW" | "MEDIUM" | "HIGH";
  milestoneDelayRisk: "LOW" | "MEDIUM" | "HIGH";
  revenueTrend: "DECLINING" | "STABLE" | "GROWING";
  explanation: string;
  recommendedAction: string;
  predictionSource: "RULE_BASED" | "AI_PROVIDER" | "SAFE_FALLBACK";
  sufficientData: boolean;
  confidenceScore: number;
  generatedAt: string;
}

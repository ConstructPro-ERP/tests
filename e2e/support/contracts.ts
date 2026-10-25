export type InvoiceStatus =
  "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";

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

export type QuotationStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "SENT"
  | "APPROVED"
  | "REJECTED"
  | "REVISED"
  | "CONVERTED";

export interface QuotationItem {
  id?: string;
  quotationId?: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Quotation {
  id: string;
  quotationNumber?: string;
  leadId: string;
  quotationDate?: string;
  status: QuotationStatus;
  subtotal?: number;
  tax?: number;
  discount?: number;
  totalAmount: number;
  notes?: string | null;
  rejectionReason?: string | null;
  pdfUrl?: string | null;
  projectId?: string | null;
  lead?: {
    id: string;
    customerName: string;
    companyName?: string;
  };
  items: QuotationItem[];
}

export interface CreateQuotationPayload {
  leadId: string;
  notes?: string;
  items: Array<{
    itemName: string;
    quantity: number;
    unitPrice: number;
  }>;
}

export interface UpdateQuotationPayload {
  notes?: string;
  items?: Array<{
    id?: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
  }>;
}

export interface RejectQuotationPayload {
  reason: string;
}

export interface ApproveQuotationPayload {
  projectName?: string;
  location?: string;
  budget?: number;
}

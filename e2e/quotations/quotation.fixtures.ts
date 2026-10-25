import type { Quotation, CreateQuotationPayload } from "../support/contracts";

export const round2 = (val: number): number =>
  Math.round((val + Number.EPSILON) * 100) / 100;

export const mockLeads = [
  {
    id: "lead-101",
    customerName: "Skyline Heights",
    companyName: "Skyline Corp",
  },
  { id: "lead-102", customerName: "Lotus Villa", companyName: "Lotus Estates" },
];

export const mockInitialQuotations: Quotation[] = [
  {
    id: "quo-mock-001",
    quotationNumber: "QUO-2026-001",
    leadId: "lead-101",
    quotationDate: "2026-10-11",
    status: "PENDING_APPROVAL",
    subtotal: 1850000,
    totalAmount: 1850000,
    notes: "Initial construction survey and foundation",
    pdfUrl: null,
    projectId: null,
    lead: {
      id: "lead-101",
      customerName: "Skyline Heights",
      companyName: "Skyline Corp",
    },
    items: [
      {
        id: "item-1",
        quotationId: "quo-mock-001",
        itemName: "Site survey & soil testing",
        quantity: 1,
        unitPrice: 350000,
        amount: 350000,
      },
      {
        id: "item-2",
        quotationId: "quo-mock-001",
        itemName: "Foundation works",
        quantity: 1,
        unitPrice: 1500000,
        amount: 1500000,
      },
    ],
  },
  {
    id: "quo-mock-002",
    quotationNumber: "QUO-2026-002",
    leadId: "lead-102",
    quotationDate: "2026-10-10",
    status: "DRAFT",
    subtotal: 45000,
    totalAmount: 45000,
    notes: "Draft architectural planning",
    pdfUrl: null,
    projectId: null,
    lead: {
      id: "lead-102",
      customerName: "Lotus Villa",
      companyName: "Lotus Estates",
    },
    items: [
      {
        id: "item-3",
        quotationId: "quo-mock-002",
        itemName: "Architectural blueprint draft",
        quantity: 1,
        unitPrice: 45000,
        amount: 45000,
      },
    ],
  },
];

export function buildQuotationPayload(
  overrides?: Partial<CreateQuotationPayload>,
): CreateQuotationPayload {
  return {
    leadId: "lead-101",
    notes: "Automated integration test quotation",
    items: [
      {
        itemName: "Structural Concrete Grade 30",
        quantity: 15,
        unitPrice: 120.5,
      },
      {
        itemName: "Reinforced Steel Rods (12mm)",
        quantity: 20,
        unitPrice: 45.25,
      },
    ],
    ...overrides,
  };
}

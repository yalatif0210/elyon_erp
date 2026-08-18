import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface QuotationProformaRow {
  id: string;
  number: string;
  status: string;
  billedVolume: string;
  uom: string;
  unitPrice: string;
  currencyCode: string;
  acceptedAt: string | null;
  generatedDocuments: { id: string; reference: string }[];
}

export interface QuotationRequestRow {
  id: string;
  desiredVolume: string;
  uom: string;
  desiredDeliveryDate: string | null;
  message: string | null;
  status: 'NEW' | 'IN_REVIEW' | 'PROFORMA_APPROVED' | 'CONVERTED' | 'DECLINED';
  createdAt: string;
  product: { code: string; name: string };
  approvedProformaId: string | null;
  proformas: QuotationProformaRow[];
}

export interface CreateQuotationDto {
  productId: string;
  desiredVolume: number;
  uom: string;
  desiredDeliveryDate?: string;
  message?: string;
}

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  defaultUom: string;
}

export interface DealRow {
  id: string;
  reference: string;
  status: string;
  contractedVolume: string;
  uom: string;
  incoterm: string;
  transportMode: string;
  currencyCode: string;
  acceptedAt: string | null;
  createdAt: string;
  product: { code: string; name: string };
}

export interface DealDetail extends DealRow {
  operations: {
    id: string;
    reference: string;
    status: string;
    plannedVolume: string;
    uom: string;
    createdAt: string;
  }[];
}

export interface OperationRow {
  id: string;
  reference: string;
  status: string;
  plannedVolume: string;
  uom: string;
  transportMode: string;
  destinationLocation: string | null;
  createdAt: string;
  deal: { reference: string };
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  type: string;
  status: string;
  billedVolume: string;
  uom: string;
  totalAmount: string;
  paidAmount: string;
  currencyCode: string;
  issueDate: string | null;
  dueDate: string | null;
  deal: { reference: string } | null;
  generatedDocuments: { id: string; reference: string; kind: string }[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private params(query: PageQuery): HttpParams {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page);
    if (query.pageSize) params = params.set('pageSize', query.pageSize);
    return params;
  }

  // --- Devis --------------------------------------------------------------

  products(): Observable<ProductRow[]> {
    return this.http.get<ProductRow[]>('/api/portal/products');
  }

  createQuotation(dto: CreateQuotationDto): Observable<QuotationRequestRow> {
    return this.http.post<QuotationRequestRow>('/api/portal/quotations', dto);
  }

  quotations(): Observable<QuotationRequestRow[]> {
    return this.http.get<QuotationRequestRow[]>('/api/portal/quotations');
  }

  /** Approbation d'une proforma reçue en réponse (§ discussion 17/08). */
  approveProforma(quotationId: string, invoiceId: string): Observable<unknown> {
    return this.http.patch(`/api/portal/quotations/${quotationId}/proformas/${invoiceId}/approuver`, {});
  }

  // --- Affaires -------------------------------------------------------------

  deals(query: PageQuery = {}): Observable<Page<DealRow>> {
    return this.http.get<Page<DealRow>>('/api/portal/deals', { params: this.params(query) });
  }

  deal(id: string): Observable<DealDetail> {
    return this.http.get<DealDetail>(`/api/portal/deals/${id}`);
  }

  acceptDeal(id: string): Observable<DealRow> {
    return this.http.patch<DealRow>(`/api/portal/deals/${id}/accept`, {});
  }

  // --- Livraisons -----------------------------------------------------------

  operations(query: PageQuery = {}): Observable<Page<OperationRow>> {
    return this.http.get<Page<OperationRow>>('/api/portal/operations', { params: this.params(query) });
  }

  // --- Factures ---------------------------------------------------------------

  invoices(query: PageQuery = {}): Observable<Page<InvoiceRow>> {
    return this.http.get<Page<InvoiceRow>>('/api/portal/invoices', { params: this.params(query) });
  }

  /**
   * Le lien de téléchargement passe par `HttpClient`, jamais par un `<a href>`
   * nu : le jeton porté par l'intercepteur est un en-tête `Authorization`, que
   * la navigation native du navigateur ne pose jamais.
   */
  downloadDocument(documentId: string): Observable<Blob> {
    return this.http.get(`/api/portal/documents/${documentId}/download`, { responseType: 'blob' });
  }
}

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

export interface ComplianceSubject {
  subject_kind: 'CARRIER' | 'VEHICLE' | 'DRIVER';
  subject_id: string;
  subject_code: string;
  subject_label: string;
  expired_count: number;
  suspended_count: number;
  expiring_count: number;
  next_expiry: string | null;
  is_compliant: boolean;
}

export interface ExpiryItem {
  id: string;
  type: string;
  reference: string;
  expiry_date: string;
  days_remaining: number;
  status: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED';
  is_blocking: boolean;
  owner_kind: string;
  owner_label: string;
  owner_id: string;
}

export interface Derogation {
  id: string;
  type: string;
  subjectType: string;
  subjectLabel: string | null;
  reason: string;
  status: string;
  grantedAt: string;
  expiresAt: string | null;
  requiresMonthlyReview: boolean;
  reviewedAt: string | null;
  authority: { fullName: string; role: string } | null;
  requestedBy: { fullName: string; role: string } | null;
}

export interface Partner {
  id: string;
  code: string;
  legalName: string;
  type: string;
  segment: string | null;
  countryCode: string;
  creditStatus: string;
  paymentTermsDays: number;
  isCompliant: boolean;
  sites: { id: string; code: string; name: string; city: string | null }[];
  _count: { complianceRecords: number; vehicles: number; drivers: number };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/internal';

  // --- Conformité (§ 6.4) --------------------------------------------------

  complianceOverview(): Observable<ComplianceSubject[]> {
    return this.http.get<ComplianceSubject[]>(`${this.base}/compliance/overview`);
  }

  nonCompliant(): Observable<ComplianceSubject[]> {
    return this.http.get<ComplianceSubject[]>(`${this.base}/compliance/non-compliant`);
  }

  expiryWatch(withinDays = 90, blockingOnly = false): Observable<ExpiryItem[]> {
    const params = new HttpParams()
      .set('withinDays', withinDays)
      .set('blockingOnly', String(blockingOnly));
    return this.http.get<ExpiryItem[]>(`${this.base}/compliance/expiry-watch`, { params });
  }

  // --- Dérogations (§ 11.4) ------------------------------------------------

  derogations(page = 1, pageSize = 50): Observable<Page<Derogation>> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<Page<Derogation>>(`${this.base}/derogations`, { params });
  }

  derogationsPendingReview(): Observable<Derogation[]> {
    return this.http.get<Derogation[]>(`${this.base}/derogations/pending-review`);
  }

  markReviewed(id: string, note?: string): Observable<Derogation> {
    return this.http.patch<Derogation>(`${this.base}/derogations/${id}/reviewed`, { note });
  }

  revokeDerogation(id: string): Observable<Derogation> {
    return this.http.patch<Derogation>(`${this.base}/derogations/${id}/revoke`, {});
  }

  // --- Référentiels --------------------------------------------------------

  partners(page = 1, search?: string): Observable<Page<Partner>> {
    let params = new HttpParams().set('page', page).set('pageSize', 50);
    if (search) params = params.set('search', search);
    return this.http.get<Page<Partner>>(`${this.base}/referentials/partners`, { params });
  }

  currencies(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/currencies`);
  }

  products(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/products`);
  }

  costPosts(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/cost-posts`);
  }

  marginThresholds(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/margin-thresholds`);
  }

  ullageTolerances(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/ullage-tolerances`);
  }

  fxRates(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/fx-rates`);
  }
}

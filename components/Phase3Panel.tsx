// Phase 3 (Depth) panel — forecast, expiry, dead stock, suppliers +
// purchase orders, branches/counters + per-counter Z, loyalty + coupons,
// accountant exports. Every number shown here comes from the server;
// the forecast section always prints the window and the rule used.
import React, { useState } from 'react';
import { Language } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { useApiData } from '../hooks/useApiData';
import { formatTaka } from '../utils/currency';

interface Props {
  lang: Language;
}

const Section: React.FC<{ title: string; testid: string; children: React.ReactNode }> = ({
  title,
  testid,
  children,
}) => (
  <section data-testid={testid} className="bg-white rounded-xl border p-4 shadow-sm">
    <h3 className="font-bold text-gray-800 mb-3">{title}</h3>
    {children}
  </section>
);

const Phase3Panel: React.FC<Props> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const [windowDays, setWindowDays] = useState(30);
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [deadWindow, setDeadWindow] = useState(90);
  const [error, setError] = useState('');

  const { data: forecastData } = useApiData(
    () => StorageService.getForecast(windowDays, leadTimeDays),
    [windowDays, leadTimeDays],
  );
  const { data: expiryData } = useApiData(() => StorageService.getExpiryAlerts(), []);
  const { data: deadData } = useApiData(() => StorageService.getDeadStock(deadWindow), [deadWindow]);
  const { data: suppliersData, refetch: refetchSuppliers } = useApiData(() => StorageService.getSuppliers(), []);
  const { data: duesData } = useApiData(() => StorageService.getSupplierDuesTotal(), []);
  const { data: poData, refetch: refetchPos } = useApiData(() => StorageService.getPurchaseOrders(), []);
  const { data: branchesData, refetch: refetchBranches } = useApiData(() => StorageService.getBranches(), []);
  const { data: zData } = useApiData(() => StorageService.getZReport(), []);
  const { data: couponsData, refetch: refetchCoupons } = useApiData(() => StorageService.getCoupons(), []);
  const { data: loyaltyData } = useApiData(() => StorageService.getLoyaltyAccounts(), []);
  const { data: productsData } = useApiData(() => StorageService.getProducts(), []);

  const suppliers = suppliersData || [];
  const purchaseOrders = poData || [];
  const branches = branchesData || [];
  const coupons = couponsData || [];
  const loyalty = loyaltyData || [];
  const products = productsData || [];

  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '' });
  const [couponForm, setCouponForm] = useState({ code: '', type: 'percent' as 'percent' | 'fixed', value: '' });
  const [branchForm, setBranchForm] = useState({ name: '' });
  const [counterForm, setCounterForm] = useState({ branchId: '', name: '' });
  const [poForm, setPoForm] = useState({ supplierId: '', productId: '', quantity: '', cost: '' });
  const [importResult, setImportResult] = useState<any>(null);

  const run = async (fn: () => Promise<any>, refetch?: () => void) => {
    setError('');
    try {
      await fn();
      refetch?.();
    } catch (e: any) {
      setError(e?.message || 'Failed');
    }
  };

  const downloadCsv = async (kind: 'vat' | 'profit-by-category' | 'staff-performance' | 'excel') => {
    try {
      const text = await StorageService.downloadReportCsv(kind);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `amar-dokan-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'Export failed');
    }
  };

  const forecastItems = forecastData?.items || [];
  const topSuggestion = forecastItems.find((f: any) => f.suggestedQty > 0);

  return (
    <div className="p-4 space-y-4 overflow-y-auto" data-testid="phase3-panel">
      <h2 className="text-lg font-bold text-gray-800">{t.depthPanel}</h2>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Section title={t.forecast} testid="phase3-forecast">
        <div className="flex flex-wrap gap-2 mb-3 text-sm">
          <label className="flex items-center gap-1">
            {lang === 'bn' ? 'জানালা (দিন)' : 'Window (days)'}
            <input
              data-testid="phase3-window-days"
              type="number"
              min={1}
              max={365}
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value) || 30)}
              className="w-20 border rounded px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1">
            {lang === 'bn' ? 'লিড টাইম (দিন)' : 'Lead time (days)'}
            <input
              data-testid="phase3-lead-days"
              type="number"
              min={0}
              max={90}
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(Number(e.target.value) || 7)}
              className="w-20 border rounded px-2 py-1"
            />
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-2" data-testid="phase3-forecast-basis">
          {t.forecastBasis}: {forecastData?.rule || ''}
        </p>
        {forecastItems.length === 0 && (
          <p className="text-sm text-gray-500">{lang === 'bn' ? 'কোনো পণ্য নেই।' : 'No products yet.'}</p>
        )}
        <ul className="space-y-1 text-sm">
          {forecastItems.slice(0, 20).map((f: any) => (
            <li key={f.productId} className="flex justify-between gap-2 border-b border-dashed pb-1">
              <span>
                {f.productName} <span className="text-gray-400 text-xs">({f.basis})</span>
              </span>
              <span className="font-bold whitespace-nowrap">
                {lang === 'bn' ? 'প্রস্তাব' : 'Suggest'}: {f.suggestedQty}
              </span>
            </li>
          ))}
        </ul>
        {topSuggestion && suppliers.length > 0 && (
          <button
            data-testid="phase3-create-draft-po"
            className="mt-3 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-bold"
            onClick={() =>
              run(async () => {
                const product = products.find((p: any) => p.id === topSuggestion.productId);
                if (!product) throw new Error('Product not found');
                await StorageService.createPurchaseOrder({
                  supplierId: suppliers[0].id,
                  items: [{ productId: product.id, quantity: topSuggestion.suggestedQty, cost: product.cost || 0 }],
                });
              }, refetchPos)
            }
          >
            {t.createDraftOrder}: {topSuggestion.productName} × {topSuggestion.suggestedQty}
          </button>
        )}
        {topSuggestion && suppliers.length === 0 && (
          <p className="text-xs text-amber-700 mt-2">
            {lang === 'bn'
              ? 'খসড়া অর্ডার তৈরি করতে প্রথমে একজন সাপ্লায়ার যোগ করুন।'
              : 'Add a supplier first to turn a suggestion into a draft order.'}
          </p>
        )}
      </Section>

      <Section title={t.expiryAlerts} testid="phase3-expiry">
        <p className="text-xs text-gray-500 mb-2">
          {lang === 'bn' ? 'সীমা: ৩০ / ১৪ / ৭ দিন' : 'Thresholds: 30 / 14 / 7 days'}
        </p>
        {(expiryData?.alerts || []).length === 0 && (
          <p className="text-sm text-gray-500">{lang === 'bn' ? 'কোনো মেয়াদ সতর্কতা নেই।' : 'No expiry alerts.'}</p>
        )}
        <ul className="space-y-1 text-sm">
          {(expiryData?.alerts || []).map((a: any) => (
            <li key={a.productId} className="flex justify-between gap-2">
              <span>{a.productName}</span>
              <span
                className={`font-bold ${a.severity === 'expired' || a.severity === 'critical' ? 'text-red-600' : a.severity === 'warning' ? 'text-amber-600' : 'text-gray-600'}`}
              >
                {a.badge} ({a.daysLeft} {lang === 'bn' ? 'দিন' : 'days'})
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t.deadStock} testid="phase3-dead-stock">
        <label className="flex items-center gap-1 text-sm mb-2">
          {lang === 'bn' ? 'জানালা (দিন)' : 'Window (days)'}
          <input
            type="number"
            min={1}
            max={365}
            value={deadWindow}
            onChange={(e) => setDeadWindow(Number(e.target.value) || 90)}
            className="w-20 border rounded px-2 py-1"
          />
        </label>
        {(deadData?.items || []).length === 0 && (
          <p className="text-sm text-gray-500">{lang === 'bn' ? 'কোনো অচল পণ্য নেই।' : 'No dead stock.'}</p>
        )}
        <ul className="space-y-1 text-sm">
          {(deadData?.items || []).map((d: any) => (
            <li key={d.productId} className="flex justify-between gap-2 border-b border-dashed pb-1">
              <span>
                {d.productName} — {lang === 'bn' ? 'মজুদ' : 'stock'} {d.stock}
              </span>
              <span className="text-gray-500">{d.suggestedAction}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={`${t.suppliers} — ${t.supplierDues}: ${formatTaka(duesData?.totalDue || 0)}`}
        testid="phase3-suppliers"
      >
        <form
          className="flex flex-wrap gap-2 mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!supplierForm.name.trim()) return;
            run(
              () =>
                StorageService.createSupplier({
                  name: supplierForm.name.trim(),
                  phone: supplierForm.phone.trim() || undefined,
                }),
              refetchSuppliers,
            );
            setSupplierForm({ name: '', phone: '' });
          }}
        >
          <input
            data-testid="phase3-supplier-name"
            placeholder={lang === 'bn' ? 'সাপ্লায়ারের নাম' : 'Supplier name'}
            value={supplierForm.name}
            onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
            className="border rounded px-2 py-1 text-sm flex-1"
          />
          <input
            placeholder={lang === 'bn' ? 'ফোন' : 'Phone'}
            value={supplierForm.phone}
            onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
            className="border rounded px-2 py-1 text-sm"
          />
          <button className="bg-emerald-600 text-white px-3 py-1 rounded text-sm font-bold" type="submit">
            {t.save}
          </button>
        </form>
        <ul className="space-y-1 text-sm">
          {suppliers.map((s: any) => (
            <li key={s.id} className="flex justify-between gap-2">
              <span>
                {s.name} {s.phone ? `(${s.phone})` : ''}
              </span>
              <span>
                {lang === 'bn' ? 'পাওনা' : 'Due'}: <b>{formatTaka(s.totalDue || 0)}</b>
              </span>
            </li>
          ))}
        </ul>
        <h4 className="font-bold mt-4 mb-2">{t.purchaseOrders}</h4>
        <form
          className="flex flex-wrap gap-2 mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!poForm.supplierId || !poForm.productId || !poForm.quantity || !poForm.cost) return;
            run(
              () =>
                StorageService.createPurchaseOrder({
                  supplierId: poForm.supplierId,
                  items: [
                    { productId: poForm.productId, quantity: Number(poForm.quantity), cost: Number(poForm.cost) },
                  ],
                }),
              refetchPos,
            );
            setPoForm({ supplierId: '', productId: '', quantity: '', cost: '' });
          }}
        >
          <select
            data-testid="phase3-po-supplier"
            value={poForm.supplierId}
            onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">{lang === 'bn' ? 'সাপ্লায়ার বাছুন' : 'Select supplier'}</option>
            {suppliers.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            data-testid="phase3-po-product"
            value={poForm.productId}
            onChange={(e) => setPoForm({ ...poForm, productId: e.target.value })}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">{lang === 'bn' ? 'পণ্য বাছুন' : 'Select product'}</option>
            {products.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            data-testid="phase3-po-qty"
            type="number"
            min={1}
            placeholder={lang === 'bn' ? 'পরিমাণ' : 'Qty'}
            value={poForm.quantity}
            onChange={(e) => setPoForm({ ...poForm, quantity: e.target.value })}
            className="w-20 border rounded px-2 py-1 text-sm"
          />
          <input
            data-testid="phase3-po-cost"
            type="number"
            min={0}
            step="0.01"
            placeholder={lang === 'bn' ? 'ক্রয়মূল্য' : 'Cost'}
            value={poForm.cost}
            onChange={(e) => setPoForm({ ...poForm, cost: e.target.value })}
            className="w-24 border rounded px-2 py-1 text-sm"
          />
          <button
            data-testid="phase3-po-create"
            className="bg-emerald-600 text-white px-3 py-1 rounded text-sm font-bold"
            type="submit"
          >
            {t.createDraftOrder}
          </button>
        </form>
        <ul className="space-y-2 text-sm">
          {purchaseOrders.map((po: any) => (
            <li key={po.id} data-testid={`phase3-po-${po.id}`} className="border rounded p-2">
              <div className="flex justify-between gap-2">
                <span>
                  {lang === 'bn' ? 'অর্ডার' : 'Order'} #{po.id.slice(-6)} — {po.status} — {formatTaka(po.totalCost)}
                </span>
                {po.status !== 'received' && po.status !== 'cancelled' && (
                  <button
                    data-testid={`phase3-po-receive-${po.id}`}
                    className="text-emerald-700 font-bold underline"
                    onClick={() =>
                      run(
                        () =>
                          StorageService.receivePurchaseOrder(
                            po.id,
                            po.items
                              .map((i: any) => ({
                                productId: i.productId,
                                quantity: i.quantity - (i.receivedQty || 0),
                              }))
                              .filter((r: any) => r.quantity > 0),
                          ),
                        () => {
                          refetchPos();
                          refetchSuppliers();
                        },
                      )
                    }
                  >
                    {t.goodsReceived}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {po.items
                  .map(
                    (i: any) =>
                      `${i.productName || i.productId} × ${i.quantity} (${lang === 'bn' ? 'গৃহীত' : 'received'} ${i.receivedQty || 0})`,
                  )
                  .join(', ')}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`${t.branches} / ${t.counters}`} testid="phase3-branches">
        <form
          className="flex flex-wrap gap-2 mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!branchForm.name.trim()) return;
            run(() => StorageService.createBranch({ name: branchForm.name.trim() }), refetchBranches);
            setBranchForm({ name: '' });
          }}
        >
          <input
            data-testid="phase3-branch-name"
            placeholder={lang === 'bn' ? 'শাখার নাম' : 'Branch name'}
            value={branchForm.name}
            onChange={(e) => setBranchForm({ name: e.target.value })}
            className="border rounded px-2 py-1 text-sm flex-1"
          />
          <button className="bg-emerald-600 text-white px-3 py-1 rounded text-sm font-bold" type="submit">
            {t.save}
          </button>
        </form>
        <ul className="space-y-1 text-sm">
          {branches.map((b: any) => (
            <li key={b.id}>
              {b.name} {b.isDefault ? (lang === 'bn' ? '(প্রধান)' : '(default)') : ''}
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap gap-2 mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!counterForm.branchId || !counterForm.name.trim()) return;
            run(() => StorageService.createCounter({ branchId: counterForm.branchId, name: counterForm.name.trim() }));
            setCounterForm({ branchId: '', name: '' });
          }}
        >
          <select
            value={counterForm.branchId}
            onChange={(e) => setCounterForm({ ...counterForm, branchId: e.target.value })}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">{lang === 'bn' ? 'শাখা বাছুন' : 'Select branch'}</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            placeholder={lang === 'bn' ? 'কাউন্টারের নাম' : 'Counter name'}
            value={counterForm.name}
            onChange={(e) => setCounterForm({ ...counterForm, name: e.target.value })}
            className="border rounded px-2 py-1 text-sm flex-1"
          />
          <button className="bg-emerald-600 text-white px-3 py-1 rounded text-sm font-bold" type="submit">
            {t.save}
          </button>
        </form>
        <h4 className="font-bold mt-4 mb-2">{t.zReportPerCounter}</h4>
        <ul className="space-y-1 text-sm">
          {(zData?.perCounter || []).map((z: any, idx: number) => (
            <li key={idx} className="flex justify-between gap-2">
              <span>{z.counterName}</span>
              <span>
                {lang === 'bn' ? 'প্রত্যাশিত' : 'Expected'} {formatTaka(z.expectedCash)} ·{' '}
                {lang === 'bn' ? 'প্রকৃত' : 'Actual'} {formatTaka(z.actualCash)} · {lang === 'bn' ? 'পার্থক্য' : 'Diff'}{' '}
                {formatTaka(z.discrepancy)}
              </span>
            </li>
          ))}
          {(zData?.perCounter || []).length === 0 && (
            <li className="text-gray-500">{lang === 'bn' ? 'এখনো কোনো বন্ধ শিফট নেই।' : 'No closed shifts yet.'}</li>
          )}
        </ul>
      </Section>

      <Section title={`${t.loyalty} / ${t.coupons}`} testid="phase3-loyalty">
        <p className="text-xs text-gray-500 mb-2">
          {lang === 'bn'
            ? 'নিয়ম: প্রতি পূর্ণ ১০০ টাকায় ১ পয়েন্ট; ১ পয়েন্ট = ১ টাকা ছাড়। সার্ভার প্রতিটি বিক্রিতে পুনরায় যাচাই করে।'
            : 'Rule: 1 point per full ৳100; 1 point = ৳1 off. The server re-validates on every sale.'}
        </p>
        <form
          className="flex flex-wrap gap-2 mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!couponForm.code.trim() || !couponForm.value) return;
            run(
              () =>
                StorageService.createCoupon({
                  code: couponForm.code.trim(),
                  type: couponForm.type,
                  value: Number(couponForm.value),
                }),
              refetchCoupons,
            );
            setCouponForm({ code: '', type: 'percent', value: '' });
          }}
        >
          <input
            data-testid="phase3-coupon-code"
            placeholder={lang === 'bn' ? 'কুপন কোড' : 'Coupon code'}
            value={couponForm.code}
            onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })}
            className="border rounded px-2 py-1 text-sm"
          />
          <select
            value={couponForm.type}
            onChange={(e) => setCouponForm({ ...couponForm, type: e.target.value as 'percent' | 'fixed' })}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="percent">%</option>
            <option value="fixed">৳</option>
          </select>
          <input
            data-testid="phase3-coupon-value"
            type="number"
            min={0}
            placeholder={lang === 'bn' ? 'মান' : 'Value'}
            value={couponForm.value}
            onChange={(e) => setCouponForm({ ...couponForm, value: e.target.value })}
            className="w-24 border rounded px-2 py-1 text-sm"
          />
          <button className="bg-emerald-600 text-white px-3 py-1 rounded text-sm font-bold" type="submit">
            {t.save}
          </button>
        </form>
        <ul className="space-y-1 text-sm">
          {coupons.map((c: any) => (
            <li key={c.id}>
              {c.code} — {c.type === 'percent' ? `${c.value}%` : formatTaka(c.value)} —{' '}
              {lang === 'bn' ? 'ব্যবহৃত' : 'used'} {c.usedCount}
              {c.maxUses ? `/${c.maxUses}` : ''}
            </li>
          ))}
          {loyalty.map((a: any) => (
            <li key={a.phone}>
              {a.phone} — {a.points} {lang === 'bn' ? 'পয়েন্ট' : 'points'}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t.accountantExports} testid="phase3-exports">
        <p className="text-xs text-gray-500 mb-2">
          {lang === 'bn'
            ? 'এক্সপোর্ট CSV ফরম্যাটে দেওয়া হয় (Excel-এ খোলে)। পিন কখনো এক্সপোর্ট হয় না।'
            : 'Exports are CSV (opens in Excel). PINs are never exported.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            data-testid="phase3-export-vat"
            className="bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-bold"
            onClick={() => downloadCsv('vat')}
          >
            VAT CSV
          </button>
          <button
            data-testid="phase3-export-profit"
            className="bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-bold"
            onClick={() => downloadCsv('profit-by-category')}
          >
            {lang === 'bn' ? 'ক্যাটাগরি অনুযায়ী লাভ' : 'Profit by Category'}
          </button>
          <button
            data-testid="phase3-export-staff"
            className="bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-bold"
            onClick={() => downloadCsv('staff-performance')}
          >
            {lang === 'bn' ? 'স্টাফ পারফরম্যান্স' : 'Staff Performance'}
          </button>
          <button
            data-testid="phase3-export-excel"
            className="bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-bold"
            onClick={() => downloadCsv('excel')}
          >
            Excel (CSV)
          </button>
          <a
            data-testid="phase3-export-full"
            className="bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-bold"
            href="/api/reports/full-export"
            target="_blank"
            rel="noreferrer"
          >
            {lang === 'bn' ? 'পূর্ণ ডেটা (JSON)' : 'Full Data (JSON)'}
          </a>
        </div>
        <form
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const el = document.getElementById('phase3-import-text') as HTMLTextAreaElement | null;
            if (!el?.value.trim()) return;
            try {
              const payload = JSON.parse(el.value);
              const result = await StorageService.importFullData(payload);
              setImportResult(result);
            } catch (err: any) {
              setError(err?.message || 'Import failed');
            }
          }}
        >
          <textarea
            id="phase3-import-text"
            data-testid="phase3-import-text"
            rows={3}
            placeholder={
              lang === 'bn'
                ? 'ইমপোর্ট JSON এখানে পেস্ট করুন (বিক্রি/খরচ কখনো ইমপোর্ট হয় না)'
                : 'Paste import JSON here (sales/expenses are never imported)'
            }
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <button
            data-testid="phase3-import-submit"
            className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-bold"
            type="submit"
          >
            {lang === 'bn' ? 'ইমপোর্ট যাচাই ও চালান' : 'Validate & Import'}
          </button>
        </form>
        {importResult && (
          <pre data-testid="phase3-import-result" className="mt-2 bg-gray-50 border rounded p-2 text-xs overflow-auto">
            {JSON.stringify(importResult, null, 2)}
          </pre>
        )}
      </Section>
    </div>
  );
};

export default Phase3Panel;

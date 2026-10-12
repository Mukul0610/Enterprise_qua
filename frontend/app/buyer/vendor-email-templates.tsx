'use client';

import React, { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import {
  fetchDispatchTemplates,
  saveDispatchTemplate,
  type DispatchTemplate,
  type DispatchTemplateType,
} from '@/lib/buyerProfileClient';
import { Mail, Save, Loader2, AlertCircle, RotateCcw } from 'lucide-react';

const DEFAULT_TEMPLATE_A: DispatchTemplate = {
  subject: '{Buyer} has mapped your supply categories — {Category}',
  message:
    '{Buyer} has added your organisation to their vendor master and mapped your supply categories from your pre-purchase order history with them.',
};

const DEFAULT_TEMPLATE_B: DispatchTemplate = {
  subject: 'Complete Your Category Mapping to Receive Enquiries',
  message:
    "{Buyer} has added your organisation to their vendor master on Procucev. No historical pre-purchase order data was available for your organisation, so your supply categories could not be mapped automatically. To become eligible for relevant enquiries, please sign in and select the categories you supply.",
};

interface EditorPanelProps {
  title: string;
  description: string;
  templateType: DispatchTemplateType;
  defaultValue: DispatchTemplate;
  value: DispatchTemplate;
  onChange: (value: DispatchTemplate) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

function EditorPanel({ title, description, defaultValue, value, onChange, onSave, saving }: EditorPanelProps) {
  const isCustomized = Boolean(value.subject || value.message);

  return (
    <div className="glass-panel rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">{description}</p>
        </div>
        {isCustomized && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            Customized
          </span>
        )}
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Subject</label>
        <input
          type="text"
          value={value.subject ?? ''}
          onChange={(e) => onChange({ ...value, subject: e.target.value })}
          placeholder={defaultValue.subject ?? ''}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
        />
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Message</label>
        <textarea
          value={value.message ?? ''}
          onChange={(e) => onChange({ ...value, message: e.target.value })}
          placeholder={defaultValue.message ?? ''}
          rows={4}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
        />
        <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-1">
          Leave blank to use the default wording shown above as a placeholder. The vendor code table and sign-in
          button are always included automatically and can&apos;t be edited here.
        </p>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 disabled:opacity-60"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save
        </button>
        {isCustomized && (
          <button
            onClick={() => onChange({ subject: null, message: null })}
            className="btn btn-secondary btn-sm text-[11px] flex items-center gap-1.5"
            disabled={saving}
          >
            <RotateCcw size={12} /> Reset to Default
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Buyer-editable subject/message for the two vendor-onboarding emails sent
 * from Step 5 of the "Buyer Initial Setup" wizard (Template A — supplier has
 * pre-purchase-order history, Template B — no history). Saved once per
 * organisation and reused on every future vendor upload: GET on mount, PUT
 * per template on save. Backed by storeService.processHistoricalPurchaseData
 * and mailerService.buildVendorCategoryMappingEmail/buildVendorSelfMappingEmail.
 */
export default function VendorEmailTemplatesPage() {
  const { showToast } = useApp();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateA, setTemplateA] = useState<DispatchTemplate>({ subject: null, message: null });
  const [templateB, setTemplateB] = useState<DispatchTemplate>({ subject: null, message: null });
  const [savingA, setSavingA] = useState(false);
  const [savingB, setSavingB] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await fetchDispatchTemplates();
      if (cancelled) return;
      if (!result.success) {
        setLoadError(result.error || 'Could not load your saved email templates.');
      } else {
        setLoadError(null);
        setTemplateA(result.data?.category_mapped || { subject: null, message: null });
        setTemplateB(result.data?.self_map_required || { subject: null, message: null });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (
    templateType: DispatchTemplateType,
    value: DispatchTemplate,
    setSaving: (v: boolean) => void
  ) => {
    setSaving(true);
    const result = await saveDispatchTemplate(templateType, {
      subject: value.subject || '',
      message: value.message || '',
    });
    setSaving(false);
    if (!result.success) {
      showToast('Save Failed', result.error || 'Could not save this template.', 'warning');
      return;
    }
    showToast('Template Saved', 'This message will be used on every future vendor upload.', 'success');
  };

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <div className="flex items-center gap-2.5">
        <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
          <Mail size={18} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Vendor Onboarding Email Templates</h2>
          <p className="text-xs text-slate-500 dark:text-gray-400">
            Customize the two emails sent to vendors when you upload a vendor master — saved once, reused on every
            future upload.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center glass-panel rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <Loader2 size={24} className="mx-auto animate-spin text-indigo-500" />
        </div>
      ) : loadError ? (
        <div className="p-6 text-center glass-panel rounded-xl space-y-2 border border-amber-300 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-950/20">
          <AlertCircle size={24} className="mx-auto text-amber-500" />
          <p className="text-xs text-slate-600 dark:text-gray-300">{loadError}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <EditorPanel
            title="Template A — Suppliers With Pre-Purchase Order History"
            description="Sent when your purchase history maps a supplier's categories automatically."
            templateType="category_mapped"
            defaultValue={DEFAULT_TEMPLATE_A}
            value={templateA}
            onChange={setTemplateA}
            onSave={() => handleSave('category_mapped', templateA, setSavingA)}
            saving={savingA}
          />
          <EditorPanel
            title="Template B — Suppliers With NO Pre-Purchase Orders"
            description="Sent when a supplier has no purchase history, so they self-map their categories."
            templateType="self_map_required"
            defaultValue={DEFAULT_TEMPLATE_B}
            value={templateB}
            onChange={setTemplateB}
            onSave={() => handleSave('self_map_required', templateB, setSavingB)}
            saving={savingB}
          />
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { supabase } from "../lib/supabase";

type EnquiryStatus = "new" | "in_progress" | "resolved";

type ContactEnquiry = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: EnquiryStatus;
  created_at: string;
};

const enquiryStatuses: EnquiryStatus[] = ["new", "in_progress", "resolved"];

function statusLabel(status: EnquiryStatus) {
  return status === "in_progress" ? "In progress" : status[0].toUpperCase() + status.slice(1);
}

function submittedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ContactEnquiries() {
  const [enquiries, setEnquiries] = useState<ContactEnquiry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | EnquiryStatus>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadEnquiries() {
      if (!supabase) {
        if (active) {
          setError("Supabase is not configured.");
          setLoading(false);
        }
        return;
      }
      const { data, error: queryError } = await supabase
        .from("contact_messages")
        .select("id,name,email,phone,message,status,created_at")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (queryError) setError(queryError.message);
      else {
        const rows = (data ?? []) as ContactEnquiry[];
        setEnquiries(rows);
        setSelectedId(rows[0]?.id ?? null);
      }
      setLoading(false);
    }
    void loadEnquiries();
    return () => { active = false; };
  }, []);

  const shownEnquiries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return enquiries.filter((enquiry) => {
      const matchesStatus = statusFilter === "all" || enquiry.status === statusFilter;
      const matchesQuery = !normalizedQuery || `${enquiry.name} ${enquiry.email} ${enquiry.phone ?? ""}`.toLowerCase().includes(normalizedQuery);
      return matchesStatus && matchesQuery;
    });
  }, [enquiries, query, statusFilter]);

  const selected = enquiries.find((enquiry) => enquiry.id === selectedId) ?? null;
  const newCount = enquiries.filter((enquiry) => enquiry.status === "new").length;

  async function updateStatus(status: EnquiryStatus) {
    if (!supabase || !selected || saving || status === selected.status) return;
    setSaving(true);
    setError("");
    const { error: updateError } = await supabase
      .from("contact_messages")
      .update({ status })
      .eq("id", selected.id);
    if (updateError) setError(updateError.message);
    else setEnquiries((current) => current.map((enquiry) => enquiry.id === selected.id ? { ...enquiry, status } : enquiry));
    setSaving(false);
  }

  return (
    <>
      <div className="admin-heading compact enquiries-heading">
        <div>
          <span className="admin-kicker">CUSTOMER CARE</span>
          <div className="enquiries-title-row">
            <h1>Contact enquiries</h1>
            {newCount > 0 ? <span className="enquiries-new-count" aria-label={`${newCount} new enquiries`}>{newCount}</span> : null}
          </div>
          <p>Review customer messages and track their follow-up status.</p>
        </div>
      </div>

      <div className="enquiries-tools">
        <div className="enquiries-search">
          <Search aria-hidden="true" />
          <input aria-label="Search enquiries" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or phone" />
        </div>
        <label className="enquiries-filter">
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | EnquiryStatus)}>
            <option value="all">All statuses</option>
            {enquiryStatuses.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}
          </select>
        </label>
      </div>

      {error ? <div className="enquiries-error" role="alert">{error}</div> : null}
      {loading ? <div className="enquiries-state">Loading contact enquiries…</div> : (
        <div className="enquiries-layout">
          <div className="enquiries-list">
            <div className="enquiries-list-head" aria-hidden="true">
              <span>Name</span><span>Email</span><span>Phone</span><span>Submitted</span><span>Status</span><span />
            </div>
            {shownEnquiries.length > 0 ? shownEnquiries.map((enquiry) => (
              <button className={`enquiry-row${selectedId === enquiry.id ? " active" : ""}`} type="button" onClick={() => setSelectedId(enquiry.id)} key={enquiry.id}>
                <strong>{enquiry.name}</strong>
                <span>{enquiry.email}</span>
                <span>{enquiry.phone ?? "—"}</span>
                <span>{submittedAt(enquiry.created_at)}</span>
                <span className={`enquiry-status ${enquiry.status}`}>{statusLabel(enquiry.status)}</span>
                <ChevronRight aria-hidden="true" />
              </button>
            )) : <div className="enquiries-state">No enquiries match these filters.</div>}
          </div>

          <aside className="enquiries-detail" aria-live="polite">
            {selected ? (
              <>
                <div className="enquiries-detail-head">
                  <div><span className="admin-kicker">FULL MESSAGE</span><h2>{selected.name}</h2></div>
                  <span className={`enquiry-status ${selected.status}`}>{statusLabel(selected.status)}</span>
                </div>
                <div className="enquiries-detail-meta">
                  <div><span>Email</span><strong>{selected.email}</strong></div>
                  <div><span>Phone</span><strong>{selected.phone ?? "Not provided"}</strong></div>
                  <div><span>Sent</span><strong>{submittedAt(selected.created_at)}</strong></div>
                </div>
                <div className="enquiries-message"><span>Message</span><p>{selected.message}</p></div>
                <label className="enquiries-status-control">
                  <span>Status</span>
                  <select value={selected.status} disabled={saving} onChange={(event) => void updateStatus(event.target.value as EnquiryStatus)}>
                    {enquiryStatuses.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}
                  </select>
                </label>
              </>
            ) : <div className="enquiries-detail-empty">Select an enquiry to read the full message.</div>}
          </aside>
        </div>
      )}
    </>
  );
}

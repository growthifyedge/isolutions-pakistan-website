import { useEffect, useState } from "react";
import { ChevronRight, Image } from "lucide-react";
import { supabase } from "../lib/supabase";

type MediaIndexRecord = {
  id: string;
  product_id: string;
  secure_url: string | null;
  alt_text: string;
  width: number | null;
  height: number | null;
  format: string | null;
  is_primary: boolean;
  product: { id: string; title: string; publication_status: string } | null;
};

export function MediaLibrary() {
  const [records, setRecords] = useState<MediaIndexRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) {
        if (active) {
          setError("Supabase client environment is not configured.");
          setLoading(false);
        }
        return;
      }
      const { data, error: queryError } = await supabase
        .from("product_media")
        .select(
          "id,product_id,secure_url,alt_text,width,height,format,is_primary,sort_order,product:products(id,title,publication_status)",
        )
        .order("product_id")
        .order("sort_order");
      if (!active) return;
      if (queryError) setError(queryError.message);
      else setRecords((data ?? []) as unknown as MediaIndexRecord[]);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const products = records.reduce<
    Array<{ product: MediaIndexRecord["product"]; media: MediaIndexRecord[] }>
  >((groups, record) => {
    const group = groups.find(
      (entry) => entry.product?.id === record.product_id,
    );
    if (group) group.media.push(record);
    else groups.push({ product: record.product, media: [record] });
    return groups;
  }, []);

  if (loading)
    return <div className="media-library-state">Loading product media…</div>;
  if (error)
    return (
      <div className="media-library-state error" role="alert">
        {error}
      </div>
    );
  if (products.length === 0)
    return (
      <div className="media-library-state">
        <Image />
        <h2>No media records yet</h2>
        <p>
          Open a saved product and use its Media tab to upload its first
          image.
        </p>
        <a href="/admin/products">Open products</a>
      </div>
    );

  return (
    <section className="media-library-list" aria-label="Product media records">
      {products.map(({ product, media }) => (
        <article key={product?.id ?? media[0].product_id}>
          <div className="media-library-product">
            <div>
              <span className="admin-kicker">PRODUCT</span>
              <h2>{product?.title ?? "Untitled product"}</h2>
              <p>
                {media.length} media record{media.length === 1 ? "" : "s"}
                {product?.publication_status
                  ? ` · ${product.publication_status}`
                  : ""}
              </p>
            </div>
            <a href={`/admin/products/${media[0].product_id}?tab=media`}>
              Manage in product <ChevronRight />
            </a>
          </div>
          <div className="media-library-thumbs">
            {media.map((item) => (
              <figure key={item.id}>
                {item.secure_url ? (
                  <img src={item.secure_url} alt={item.alt_text} />
                ) : (
                  <div className="media-library-missing">
                    <Image />
                  </div>
                )}
                <figcaption>
                  <strong>{item.alt_text}</strong>
                  <span>
                    {item.is_primary ? "Primary · " : ""}
                    {item.width && item.height
                      ? `${item.width} × ${item.height}`
                      : "Dimensions pending"}
                    {item.format ? ` · ${item.format.toUpperCase()}` : ""}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

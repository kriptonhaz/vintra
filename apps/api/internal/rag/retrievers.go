package rag

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
)

// retrieverFor maps retrieval_type to its implementation.
var retrieverFor = map[string]Retriever{
	"inventory_price":      &inventoryPriceRetriever{},
	"inventory_stock":      &inventoryStockRetriever{},
	"store_address":        &storeAddressRetriever{},
	"operating_hours":      &operatingHoursRetriever{},
	"payment_methods":      &paymentMethodsRetriever{},
	"promotions":           &promotionsRetriever{},
	"loyalty_points":       &loyaltyPointsRetriever{},
	"loyalty_stamps":       &loyaltyStampsRetriever{},
	"order_history":        &orderHistoryRetriever{},
	"recipe_availability":  &recipeAvailabilityRetriever{},
	"online_orders_status": &onlineOrdersStatusRetriever{},
}

// onlineOrderStatusLabel maps an online order status to an Indonesian
// label for the buyer-facing reply. 'cancelled' is intentionally absent —
// the retriever query excludes cancelled orders.
var onlineOrderStatusLabel = map[string]string{
	"pending":   "Menunggu pembayaran",
	"confirmed": "Pembayaran dikonfirmasi",
	"ready":     "Siap diambil",
	"shipped":   "Sedang dikirim",
	"completed": "Selesai",
}

func rowsToMaps(cols []string, vals [][]any) []map[string]any {
	out := make([]map[string]any, 0, len(vals))
	for _, row := range vals {
		m := make(map[string]any, len(cols))
		for i, c := range cols {
			if i < len(row) {
				m[c] = row[i]
			}
		}
		out = append(out, m)
	}
	return out
}

func formatRupiah(v string) string {
	if idx := strings.Index(v, "."); idx >= 0 {
		v = v[:idx]
	}
	return "Rp " + v
}

// ── 1. inventory_price ────────────────────────────────────────────────────────

type inventoryPriceRetriever struct{}

func (r *inventoryPriceRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, _ string, tokens []string, isCatalog bool, verbose bool) ([]Snippet, error) {
	catalog := isCatalog
	if !catalog && len(tokens) == 0 {
		return nil, nil
	}
	args := []any{tenantID}
	var nameFilter string
	limit := 5
	if !catalog {
		conds := make([]string, len(tokens))
		for i, t := range tokens {
			args = append(args, "%"+t+"%")
			conds[i] = fmt.Sprintf("ii.name ILIKE $%d", i+2)
		}
		nameFilter = "AND (" + strings.Join(conds, " OR ") + ")"
	} else {
		// Catalog mode — customer asked for the whole list. Surface more rows
		// since the LLM uses these to enumerate options, but cap at 10 to keep
		// the prompt budget reasonable.
		limit = 10
	}
	// Exclude recipe-based items — recipe_availability already includes their
	// selling_price alongside producibility. Listing them here too would either
	// duplicate the price (token waste) or confuse the AI into treating them as
	// separate SKUs.
	q := fmt.Sprintf(`
		SELECT ii.name, mhu.label, iup.unit_price::text
		FROM inventory_items ii
		JOIN inventory_item_unit_pricing iup ON iup.item_id = ii.id AND iup.min_qty = 1
		JOIN master_hpp_units mhu ON mhu.id = iup.unit_id
		WHERE ii.tenant_id = $1 AND ii.is_active = true AND ii.is_sellable = true
		  AND ii.linked_hpp_product_id IS NULL
		  %s
		ORDER BY ii.name LIMIT %d`, nameFilter, limit)

	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []string
	var rawVals [][]any
	for rows.Next() {
		var name, unit, price string
		if err := rows.Scan(&name, &unit, &price); err != nil {
			return nil, err
		}
		parts = append(parts, fmt.Sprintf("%s (%s) — %s", name, unit, formatRupiah(price)))
		if verbose {
			rawVals = append(rawVals, []any{name, unit, price})
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}
	s := Snippet{Text: "Harga: " + strings.Join(parts, "; "), Source: "inventory_price"}
	if verbose {
		s.RawRows = rowsToMaps([]string{"name", "unit", "price"}, rawVals)
	}
	return []Snippet{s}, nil
}

// ── 2. inventory_stock ────────────────────────────────────────────────────────

type inventoryStockRetriever struct{}

func (r *inventoryStockRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, _ string, tokens []string, isCatalog bool, verbose bool) ([]Snippet, error) {
	catalog := isCatalog
	if !catalog && len(tokens) == 0 {
		return nil, nil
	}
	args := []any{tenantID}
	var nameFilter string
	limit := 5
	if !catalog {
		conds := make([]string, len(tokens))
		for i, t := range tokens {
			args = append(args, "%"+t+"%")
			conds[i] = fmt.Sprintf("ii.name ILIKE $%d", i+2)
		}
		nameFilter = "AND (" + strings.Join(conds, " OR ") + ")"
	} else {
		limit = 10
	}
	// Exclude recipe-based finished goods (linked_hpp_product_id IS NOT NULL).
	// Those items are made-to-order from ingredients — their finished-cup stock
	// is always 0, which would tell the AI "stok kosong" even when the cafe can
	// happily produce dozens. The recipe_availability tool handles them via BOM
	// + ingredient stock instead. Direct-stocked items (packaged Indomilk, retail
	// goods) keep linked_hpp_product_id = NULL and are still returned here.
	q := fmt.Sprintf(`
		SELECT ii.name, mhu.label, COALESCE(SUM(isb.quantity), 0)::text
		FROM inventory_items ii
		JOIN master_hpp_units mhu ON mhu.id = ii.base_unit_id
		LEFT JOIN inventory_stock_balances isb ON isb.item_id = ii.id AND isb.tenant_id = $1
		WHERE ii.tenant_id = $1 AND ii.is_active = true AND ii.is_sellable = true
		  AND ii.linked_hpp_product_id IS NULL
		  %s
		GROUP BY ii.name, mhu.label
		ORDER BY SUM(isb.quantity) DESC NULLS LAST LIMIT %d`, nameFilter, limit)

	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []string
	var rawVals [][]any
	for rows.Next() {
		var name, unit, qty string
		if err := rows.Scan(&name, &unit, &qty); err != nil {
			return nil, err
		}
		// Strip decimal from qty
		if idx := strings.Index(qty, "."); idx >= 0 {
			qty = qty[:idx]
		}
		parts = append(parts, fmt.Sprintf("%s — %s %s", name, qty, unit))
		if verbose {
			rawVals = append(rawVals, []any{name, unit, qty})
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}
	s := Snippet{Text: "Stok: " + strings.Join(parts, "; "), Source: "inventory_stock"}
	if verbose {
		s.RawRows = rowsToMaps([]string{"name", "unit", "qty"}, rawVals)
	}
	return []Snippet{s}, nil
}

// ── 3. store_address ──────────────────────────────────────────────────────────

type storeAddressRetriever struct{}

func (r *storeAddressRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, _ string, _ []string, _ bool, verbose bool) ([]Snippet, error) {
	rows, err := db.Query(ctx,
		`SELECT name, address FROM branches WHERE tenant_id = $1 AND is_active = true ORDER BY is_main DESC LIMIT 3`,
		tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []string
	var rawVals [][]any
	for rows.Next() {
		var name string
		var address pgtype.Text
		if err := rows.Scan(&name, &address); err != nil {
			return nil, err
		}
		if address.Valid && address.String != "" {
			parts = append(parts, fmt.Sprintf("%s: %s", name, address.String))
		} else {
			parts = append(parts, name)
		}
		if verbose {
			rawVals = append(rawVals, []any{name, address.String})
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}
	s := Snippet{Text: "Alamat toko: " + strings.Join(parts, " | "), Source: "store_address"}
	if verbose {
		s.RawRows = rowsToMaps([]string{"name", "address"}, rawVals)
	}
	return []Snippet{s}, nil
}

// ── 4. operating_hours ────────────────────────────────────────────────────────

type operatingHoursRetriever struct{}

var dayNames = []string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}

func (r *operatingHoursRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, _ string, _ []string, _ bool, verbose bool) ([]Snippet, error) {
	var raw pgtype.Text
	err := db.QueryRow(ctx,
		`SELECT business_hours::text FROM branches WHERE tenant_id = $1 AND is_main = true LIMIT 1`,
		tenantID).Scan(&raw)
	if err != nil || !raw.Valid || raw.String == "" || raw.String == "null" {
		slog.Info("rag: operating_hours has no data", "tenantId", tenantID)
		return nil, nil
	}

	type entry struct {
		Day   int    `json:"day"`
		Open  string `json:"open"`
		Close string `json:"close"`
	}
	var hours []entry
	if err := json.Unmarshal([]byte(raw.String), &hours); err != nil || len(hours) == 0 {
		return nil, nil
	}

	var parts []string
	var rawVals [][]any
	for _, h := range hours {
		if h.Day >= 0 && h.Day <= 6 {
			parts = append(parts, fmt.Sprintf("%s %s–%s", dayNames[h.Day], h.Open, h.Close))
			if verbose {
				rawVals = append(rawVals, []any{dayNames[h.Day], h.Open, h.Close})
			}
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}
	s := Snippet{Text: "Jam buka: " + strings.Join(parts, ", "), Source: "operating_hours"}
	if verbose {
		s.RawRows = rowsToMaps([]string{"day", "open", "close"}, rawVals)
	}
	return []Snippet{s}, nil
}

// ── 5. payment_methods ────────────────────────────────────────────────────────

type paymentMethodsRetriever struct{}

func (r *paymentMethodsRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, _ string, _ []string, _ bool, verbose bool) ([]Snippet, error) {
	var methods []string
	if err := db.QueryRow(ctx,
		`SELECT default_payment_methods FROM pos_settings WHERE tenant_id = $1`,
		tenantID).Scan(&methods); err != nil || len(methods) == 0 {
		return nil, nil
	}

	labels := map[string]string{
		"cash": "Cash", "qris": "QRIS", "transfer": "Transfer Bank",
		"dana": "DANA", "gopay": "GoPay", "ovo": "OVO", "shopeepay": "ShopeePay",
	}
	pretty := make([]string, len(methods))
	for i, m := range methods {
		if l, ok := labels[m]; ok {
			pretty[i] = l
		} else {
			pretty[i] = strings.ToUpper(m[:1]) + m[1:]
		}
	}
	s := Snippet{Text: "Metode pembayaran: " + strings.Join(pretty, ", "), Source: "payment_methods"}
	if verbose {
		s.RawRows = []map[string]any{{"methods": methods}}
	}
	return []Snippet{s}, nil
}

// ── 6. promotions ─────────────────────────────────────────────────────────────

type promotionsRetriever struct{}

func (r *promotionsRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, _ string, _ []string, _ bool, verbose bool) ([]Snippet, error) {
	rows, err := db.Query(ctx, `
		SELECT name, discount_type, discount_value::text, ends_at, image_key
		FROM tenant_promotions
		WHERE tenant_id = $1 AND is_active = true
		  AND (starts_at IS NULL OR starts_at <= now())
		  AND (ends_at IS NULL OR ends_at >= now())
		ORDER BY created_at DESC LIMIT 3`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []string
	var rawVals [][]any
	var attachments []SnippetAttachment
	for rows.Next() {
		var name, discType, discValue string
		var endsAt pgtype.Timestamp
		var imageKey pgtype.Text
		if err := rows.Scan(&name, &discType, &discValue, &endsAt, &imageKey); err != nil {
			return nil, err
		}
		var desc string
		if discType == "percent" {
			desc = discValue + "% off"
		} else {
			desc = "diskon " + formatRupiah(discValue)
		}
		if endsAt.Valid {
			desc += fmt.Sprintf(" s/d %d %s", endsAt.Time.Day(), endsAt.Time.Month().String()[:3])
		}
		parts = append(parts, name+" — "+desc)
		// Promos with an uploaded banner — surface for the post-reply
		// scanner. The AI reply layer fuzzy-matches `Name` against the
		// generated text and enqueues a wa:send_image task per match.
		if imageKey.Valid && imageKey.String != "" {
			attachments = append(attachments, SnippetAttachment{
				Name:     name,
				ImageKey: imageKey.String,
			})
		}
		if verbose {
			rawVals = append(rawVals, []any{name, discType, discValue})
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}
	s := Snippet{Text: "Promo aktif: " + strings.Join(parts, "; "), Source: "promotions"}
	s.Attachments = attachments
	if verbose {
		s.RawRows = rowsToMaps([]string{"name", "discount_type", "discount_value"}, rawVals)
	}
	return []Snippet{s}, nil
}

// ── 7. loyalty_points ─────────────────────────────────────────────────────────

type loyaltyPointsRetriever struct{}

func (r *loyaltyPointsRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, remoteJid string, _ []string, _ bool, verbose bool) ([]Snippet, error) {
	phone := NormalizePhone(remoteJid)
	if phone == "" {
		return nil, nil
	}
	var name, points string
	err := db.QueryRow(ctx, `
		SELECT c.name, clb.points_balance::text
		FROM customers c
		JOIN customer_loyalty_balances clb ON clb.customer_id = c.id
		WHERE c.tenant_id = $1 AND c.phone = $2 LIMIT 1`,
		tenantID, phone).Scan(&name, &points)
	if err != nil {
		return nil, nil // no match — silent skip
	}
	if idx := strings.Index(points, "."); idx >= 0 {
		points = points[:idx]
	}
	s := Snippet{
		Text:   fmt.Sprintf("Pelanggan: %s — %s poin loyalti tersedia", name, points),
		Source: "loyalty_points",
	}
	if verbose {
		s.RawRows = []map[string]any{{"name": name, "points_balance": points}}
	}
	return []Snippet{s}, nil
}

// ── 8. order_history ──────────────────────────────────────────────────────────

type orderHistoryRetriever struct{}

func (r *orderHistoryRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, remoteJid string, _ []string, _ bool, verbose bool) ([]Snippet, error) {
	phone := NormalizePhone(remoteJid)
	if phone == "" {
		return nil, nil
	}
	var customerID pgtype.UUID
	if err := db.QueryRow(ctx,
		`SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
		tenantID, phone).Scan(&customerID); err != nil {
		return nil, nil
	}

	rows, err := db.Query(ctx, `
		SELECT sale_number, total::text, created_at
		FROM pos_sales
		WHERE tenant_id = $1 AND customer_id = $2
		ORDER BY created_at DESC LIMIT 5`, tenantID, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []string
	var rawVals [][]any
	for rows.Next() {
		var saleNum, total string
		var createdAt pgtype.Timestamp
		if err := rows.Scan(&saleNum, &total, &createdAt); err != nil {
			return nil, err
		}
		date := ""
		if createdAt.Valid {
			date = fmt.Sprintf(" (%d %s)", createdAt.Time.Day(), createdAt.Time.Month().String()[:3])
		}
		parts = append(parts, fmt.Sprintf("#%s %s%s", saleNum, formatRupiah(total), date))
		if verbose {
			rawVals = append(rawVals, []any{saleNum, total})
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}
	s := Snippet{Text: "Pesanan terakhir: " + strings.Join(parts, ", "), Source: "order_history"}
	if verbose {
		s.RawRows = rowsToMaps([]string{"sale_number", "total"}, rawVals)
	}
	return []Snippet{s}, nil
}

// onlinePaymentLabel maps an online order payment method to an Indonesian
// label for the buyer-facing reply.
var onlinePaymentLabel = map[string]string{
	"transfer":  "Transfer Bank",
	"qris":      "QRIS",
	"cash":      "Tunai (bayar di tempat)",
	"dana":      "DANA",
	"gopay":     "GoPay",
	"ovo":       "OVO",
	"shopeepay": "ShopeePay",
}

// onlineOrdersStatusRetriever looks up the buyer's TOKO ONLINE orders by
// their WhatsApp number so the AI can answer "where's my order?" even when
// the buyer lost their order number. Scope: in-progress orders (pending /
// confirmed / ready / shipped) plus orders completed in the last 14 days.
// Cancelled orders are excluded. Newest first, capped at 5. Each line
// carries the order number, status, items, total, and payment method (plus
// courier + resi for shipped). When any order is still awaiting a bank
// transfer, the tenant's transfer account(s) are appended so the AI can
// tell the buyer exactly where to pay.
type onlineOrdersStatusRetriever struct{}

func (r *onlineOrdersStatusRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, remoteJid string, _ []string, _ bool, verbose bool) ([]Snippet, error) {
	phone := NormalizePhone(remoteJid)
	if phone == "" {
		return nil, nil
	}

	rows, err := db.Query(ctx, `
		SELECT o.order_number, o.status, o.total::text, o.payment_method,
		       o.courier_name, o.tracking_number,
		       COALESCE((
		         SELECT string_agg(
		           oi.qty::int || 'x ' || oi.name_snapshot ||
		           CASE WHEN COALESCE(oi.variant_label, '') <> ''
		                THEN ' (' || oi.variant_label || ')' ELSE '' END,
		           ', ' ORDER BY oi.created_at)
		         FROM online_order_items oi WHERE oi.order_id = o.id
		       ), '') AS items
		FROM online_orders o
		WHERE o.tenant_id = $1 AND o.customer_phone = $2
		  AND (
		    o.status IN ('pending','confirmed','ready','shipped')
		    OR (o.status = 'completed'
		        AND COALESCE(o.completed_at, o.updated_at) >= now() - interval '14 days')
		  )
		ORDER BY o.created_at DESC
		LIMIT 5`, tenantID, phone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []string
	var rawVals [][]any
	awaitingTransfer := false
	i := 0
	for rows.Next() {
		var orderNum, status, total, items string
		var payMethod, courier, tracking pgtype.Text
		if err := rows.Scan(&orderNum, &status, &total, &payMethod, &courier, &tracking, &items); err != nil {
			return nil, err
		}
		i++
		label := onlineOrderStatusLabel[status]
		if label == "" {
			label = status
		}
		resi := ""
		if status == "shipped" && tracking.Valid && tracking.String != "" {
			if courier.Valid && courier.String != "" {
				resi = fmt.Sprintf(" (resi %s: %s)", courier.String, tracking.String)
			} else {
				resi = fmt.Sprintf(" (resi: %s)", tracking.String)
			}
		}
		itemPart := ""
		if items != "" {
			itemPart = "; item: " + items
		}
		pay := ""
		if payMethod.Valid && payMethod.String != "" {
			pl := onlinePaymentLabel[payMethod.String]
			if pl == "" {
				pl = payMethod.String
			}
			pay = "; bayar via " + pl
			if payMethod.String == "transfer" && status == "pending" {
				awaitingTransfer = true
			}
		}
		parts = append(parts, fmt.Sprintf("%d) %s — %s%s%s; total %s%s",
			i, orderNum, label, resi, itemPart, formatRupiah(total), pay))
		if verbose {
			rawVals = append(rawVals, []any{orderNum, status, total})
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}

	text := "Pesanan online pelanggan ini: " + strings.Join(parts, " | ")

	// For orders still awaiting a bank transfer, append the destination
	// account(s) so the AI can answer "bayarnya ke mana?". Bank accounts
	// are the single source of truth on pos_settings (jsonb).
	if awaitingTransfer {
		if banks := fetchActiveBankAccounts(ctx, db, tenantID); banks != "" {
			text += " || Rekening transfer tujuan: " + banks
		}
	}

	s := Snippet{Text: text, Source: "online_orders_status"}
	if verbose {
		s.RawRows = rowsToMaps([]string{"order_number", "status", "total"}, rawVals)
	}
	return []Snippet{s}, nil
}

// fetchActiveBankAccounts returns a human-readable list of the tenant's
// active transfer accounts ("BCA 123 a.n. Budi; BNI 456 a.n. Budi") from
// pos_settings.bank_accounts, or "" when none/unreadable. Best-effort —
// the order snippet still renders without it.
func fetchActiveBankAccounts(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID) string {
	var raw []byte
	if err := db.QueryRow(ctx,
		`SELECT bank_accounts FROM pos_settings WHERE tenant_id = $1`,
		tenantID).Scan(&raw); err != nil || len(raw) == 0 {
		return ""
	}
	var accts []struct {
		BankName      string `json:"bankName"`
		AccountNumber string `json:"accountNumber"`
		AccountHolder string `json:"accountHolder"`
		Active        bool   `json:"active"`
	}
	if err := json.Unmarshal(raw, &accts); err != nil {
		return ""
	}
	var out []string
	for _, a := range accts {
		if !a.Active || a.AccountNumber == "" {
			continue
		}
		line := strings.TrimSpace(a.BankName + " " + a.AccountNumber)
		if a.AccountHolder != "" {
			line += " a.n. " + a.AccountHolder
		}
		out = append(out, line)
	}
	return strings.Join(out, "; ")
}

// ── 9. recipe_availability ────────────────────────────────────────────────────
//
// For recipe-based products (cafe / F&B / anything with a HPP BOM) the
// "stock" of the finished item is derived, not stored. A customer asking
// "ada teh susu?" wants to know how many cups can be made from current
// ingredient levels — not how many beans / how many ml of milk we have.
//
// Algorithm:
//   1. Match tokens against products.name.
//   2. Load BOM rows (product_materials) where material_id IS NOT NULL
//      (skipping nested-recipe rows per JUR-10 — same logic the POS
//      ingredient deduction uses).
//   3. For each BOM row: stock_of_material / recipe_qty = producible_for_this_line.
//      `inventory_items.linked_hpp_material_id` is the bridge; stock comes
//      from inventory_stock_balances summed across branches.
//   4. min(producible_per_line) = max units of the product we can make.
//   5. Report the constraining (lowest) material as the bottleneck so the
//      AI can answer "kenapa terbatas?" without a follow-up query.
//
// Caveats v1:
//   - Unit mismatches (recipe in ml, inventory in liter) are not converted.
//     POS deduction has the same limitation; matching the existing contract.
//   - Products with no BOM (resale-only) return max_producible=0 — they
//     should be enabled via Stok Barang instead.

type recipeAvailabilityRetriever struct{}

func (r *recipeAvailabilityRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, _ string, tokens []string, isCatalog bool, verbose bool) ([]Snippet, error) {
	catalog := isCatalog
	if !catalog && len(tokens) == 0 {
		return nil, nil
	}
	args := []any{tenantID}
	var nameFilter string
	if !catalog {
		conds := make([]string, len(tokens))
		for i, t := range tokens {
			args = append(args, "%"+t+"%")
			conds[i] = fmt.Sprintf("p.name ILIKE $%d", i+2)
		}
		nameFilter = "AND (" + strings.Join(conds, " OR ") + ")"
	}

	// Single CTE-driven query. Two stages so the per-BOM-line producibility
	// is computed before the MIN across lines. Catalog mode skips the name
	// filter so the customer's "menu apa aja?" lists everything.
	q := fmt.Sprintf(`
		WITH product_matches AS (
			SELECT p.id, p.name, p.selling_price
			FROM products p
			WHERE p.tenant_id = $1 %s
			ORDER BY p.name ASC
			LIMIT 10
		),
		producible_per_bom AS (
			SELECT
				pm.product_id,
				m.name AS material_name,
				pm.quantity AS recipe_qty,
				COALESCE(SUM(isb.quantity), 0) AS material_stock,
				CASE WHEN pm.quantity > 0
				     THEN FLOOR(COALESCE(SUM(isb.quantity), 0) / pm.quantity)
				     ELSE 0 END AS max_producible
			FROM product_matches pmatch
			JOIN product_materials pm ON pm.product_id = pmatch.id AND pm.material_id IS NOT NULL
			JOIN materials m ON m.id = pm.material_id
			JOIN inventory_items ii
			  ON ii.linked_hpp_material_id = m.id AND ii.tenant_id = $1
			LEFT JOIN inventory_stock_balances isb
			  ON isb.item_id = ii.id AND isb.tenant_id = $1
			GROUP BY pm.product_id, pm.id, m.name, pm.quantity
		)
		SELECT
			pmatch.name,
			pmatch.selling_price::text,
			COALESCE(MIN(ppb.max_producible)::int, 0) AS max_producible,
			(array_agg(ppb.material_name ORDER BY ppb.max_producible ASC NULLS FIRST))[1] AS bottleneck
		FROM product_matches pmatch
		LEFT JOIN producible_per_bom ppb ON ppb.product_id = pmatch.id
		GROUP BY pmatch.id, pmatch.name, pmatch.selling_price
		ORDER BY pmatch.name ASC
		LIMIT 10`, nameFilter)

	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []string
	var rawVals [][]any
	for rows.Next() {
		var name, price string
		var maxProducible int32
		var bottleneck pgtype.Text
		if err := rows.Scan(&name, &price, &maxProducible, &bottleneck); err != nil {
			return nil, err
		}
		var phrase string
		switch {
		case maxProducible <= 0:
			// Either no BOM, no linked inventory, or an ingredient at zero stock.
			// "Stok bahan kurang" beats "0 cup" — the AI handles it more naturally.
			phrase = "stok bahan kurang"
		case bottleneck.Valid && bottleneck.String != "":
			phrase = fmt.Sprintf("bisa dibuat ~%d porsi (terbatas oleh: %s)", maxProducible, bottleneck.String)
		default:
			phrase = fmt.Sprintf("bisa dibuat ~%d porsi", maxProducible)
		}
		// In catalog mode the customer asked "what's on the menu" — render
		// name only. Price + producibility leak as "Rp 4.000" / "60 porsi"
		// in the AI reply, which exposes pricing and inventory levels the
		// tenant probably doesn't want surfaced unsolicited. Items that
		// can't currently be made (max_producible <= 0) are skipped entirely
		// so the AI never offers something the kitchen can't deliver.
		//
		// On a specific question ("berapa harga teh?"), isCatalog=false and
		// we render the full snippet — same as before.
		if catalog {
			if maxProducible <= 0 {
				continue
			}
			parts = append(parts, name)
		} else {
			parts = append(parts, fmt.Sprintf("%s — %s · %s", name, formatRupiah(price), phrase))
		}
		if verbose {
			b := ""
			if bottleneck.Valid {
				b = bottleneck.String
			}
			rawVals = append(rawVals, []any{name, price, maxProducible, b})
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}
	s := Snippet{Text: "Menu: " + strings.Join(parts, "; "), Source: "recipe_availability"}
	if verbose {
		s.RawRows = rowsToMaps([]string{"name", "selling_price", "max_producible", "bottleneck"}, rawVals)
	}
	return []Snippet{s}, nil
}

// ── 10. loyalty_stamps ────────────────────────────────────────────────────────
//
// Per-customer stamp-card progress. Like loyalty_points but for the
// punch-card system (count of qualifying purchases, not Rupiah). The
// customer is identified by remoteJid → phone, then we aggregate every
// active program they have a card on. One snippet, one line per program:
//
//   "Kartu stempel Budi: Cuci Motor 3/5 (2 lagi gratis Cuci Motor);
//    Kopi Pagi 4/8 (4 lagi gratis paket hadiah)"
//
// Cards with `current_stamps = 0` are dropped — the LLM doesn't need to
// announce "you have no progress" on every dormant card. Cards from
// archived programs are dropped too: showing them invites questions the
// owner doesn't want to handle ("kok kartu saya hilang?").

type loyaltyStampsRetriever struct{}

func (r *loyaltyStampsRetriever) Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID, remoteJid string, _ []string, _ bool, verbose bool) ([]Snippet, error) {
	phone := NormalizePhone(remoteJid)
	if phone == "" {
		return nil, nil
	}

	var customerID pgtype.UUID
	var customerName string
	if err := db.QueryRow(ctx,
		`SELECT id, name FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
		tenantID, phone).Scan(&customerID, &customerName); err != nil {
		return nil, nil // unknown customer — silent skip
	}

	rows, err := db.Query(ctx, `
		SELECT
			lsp.name,
			csc.current_stamps,
			lsp.stamps_required,
			lsp.reward_mode,
			COALESCE(ii.name, '') AS reward_item_name
		FROM customer_stamp_cards csc
		JOIN loyalty_stamp_programs lsp ON lsp.id = csc.program_id
		LEFT JOIN inventory_items ii ON ii.id = lsp.reward_item_id
		WHERE csc.tenant_id = $1
		  AND csc.customer_id = $2
		  AND lsp.is_active = TRUE
		  AND csc.current_stamps > 0
		ORDER BY csc.current_stamps DESC
		LIMIT 5`,
		tenantID, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var parts []string
	var rawVals [][]any
	for rows.Next() {
		var progName, rewardMode, rewardItemName string
		var current, required int32
		if err := rows.Scan(&progName, &current, &required, &rewardMode, &rewardItemName); err != nil {
			return nil, err
		}
		// Reward label: single-mode reads the item name; bundle mode
		// (or missing item) collapses to a generic "paket hadiah" so
		// the snippet stays short without an extra bundle join.
		rewardLabel := rewardItemName
		if rewardMode == "bundle" || rewardLabel == "" {
			rewardLabel = "paket hadiah"
		}
		remaining := int(required) - int(current)
		var line string
		if remaining <= 0 {
			line = fmt.Sprintf("%s %d/%d stempel — sudah bisa ditukar %s", progName, current, required, rewardLabel)
		} else {
			line = fmt.Sprintf("%s %d/%d stempel (%d lagi gratis %s)", progName, current, required, remaining, rewardLabel)
		}
		parts = append(parts, line)
		if verbose {
			rawVals = append(rawVals, []any{progName, current, required, rewardMode, rewardItemName})
		}
	}
	if len(parts) == 0 {
		return nil, nil
	}

	s := Snippet{
		Text:   fmt.Sprintf("Kartu stempel %s: %s", customerName, strings.Join(parts, "; ")),
		Source: "loyalty_stamps",
	}
	if verbose {
		s.RawRows = rowsToMaps(
			[]string{"program_name", "current_stamps", "stamps_required", "reward_mode", "reward_item_name"},
			rawVals,
		)
	}
	return []Snippet{s}, nil
}

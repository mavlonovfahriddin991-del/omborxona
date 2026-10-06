const BASE = "http://localhost:4000";
const j = async (p, o = {}) => {
  const r = await fetch(BASE + p, { ...o, headers: { "Content-Type": "application/json", ...(o.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, d };
};
(async () => {
  const L = await j("/api/login", { method: "POST", body: JSON.stringify({ login: "admin", pass: "1234" }) });
  const H = { Authorization: "Bearer " + L.d.token };
  const me = await j("/api/me", { headers: H });
  console.log("Kirish:", me.d.name, "/", me.d.role);

  const dash = await j("/api/report/dashboard", { headers: H });
  console.log("Boshqaruv paneli:", JSON.stringify({ items: dash.d.items, locations: dash.d.locations, positions: dash.d.positions, total_qty: dash.d.total_qty, value: dash.d.value, drafts: dash.d.drafts }));
  console.log("Hujjat turlari (tasdiqlangan):", JSON.stringify(dash.d.by_type), "| oylik kirim", dash.d.month_in, "chiqim", dash.d.month_out);
  console.log("Min zaxiradan past:", dash.d.low.length, "ta | muddatiga yaqin:", dash.d.expiring.length, "ta");

  const items = await j("/api/items", { headers: H });
  console.log("Nomenklatura:", items.d.items.length, "ta pozitsiya | kategoriyalar:", items.d.cats.join(", "));
  const it = items.d.items[0];
  console.log("Namuna:", it.name, it.sku, "shtrix", it.barcode, "birlik", it.unit, "min", it.min_stock, "tannarx", it.cost);

  const locs = await j("/api/locations", { headers: H });
  console.log("Joylar:", locs.d.length, "|", locs.d.map((l) => `${l.code}:${l.used_cells}/${l.total_cells}`).join(" "));
  const st = await j("/api/stocks", { headers: H });
  const s0 = st.d[0];
  console.log("Pozitsiya:", s0.code, s0.item_name, "@", s0.loc_code, s0.cell, "=", s0.qty, s0.unit);

  /* --- KIRIM --- */
  const nxt = await j("/api/docs/next/kirish", { headers: H });
  const blank = locs.d.find((l) => l.cells.some((c) => c.qty === 0));
  const cell = blank ? blank.cells.find((c) => c.qty === 0) : locs.d[0].cells[0];
  const kir = await j("/api/docs", {
    method: "POST", headers: H,
    body: JSON.stringify({ type: "kirish", doc_date: "2026-09-26", supplier_id: 1, note: "Test kirim",
      lines: [{ item_id: it.id, location_id: blank ? blank.id : locs.d[0].id, cell_row: cell.row, cell_col: cell.col, qty: 55, batch_no: "T-01", expiry: "2027-12-31" }] })
  });
  console.log("Kirim hujjati:", kir.d.no, "| tasdiqlandi:", (await j("/api/docs/" + kir.d.id + "/confirm", { method: "POST", headers: H })).d.ok);
  const st2 = await j("/api/stocks?q=T-01", { headers: H });
  console.log("Kirim qat'iyi: partiya T-01 ->", st2.d[0].qty, st2.d[0].unit, "@", st2.d[0].loc_code + "-" + st2.d[0].cell, "(kutilgan 55)");
  const confTwice = await j("/api/docs/" + kir.d.id + "/confirm", { method: "POST", headers: H });
  console.log("Ikki marta tasdiqlash rad etildi:", confTwice.d.error);

  /* --- CHIQIM --- */
  const chq = await j("/api/docs", {
    method: "POST", headers: H,
    body: JSON.stringify({ type: "chiqim", dest: "Apteka peshtaxtasi", lines: [{ item_id: st2.d[0].item_id, stock_id: st2.d[0].id, location_id: st2.d[0].location_id, cell_row: st2.d[0].cell_row, cell_col: st2.d[0].cell_col, qty: 5 }] })
  });
  await j("/api/docs/" + chq.d.id + "/confirm", { method: "POST", headers: H });
  const st3 = await j("/api/stocks?q=T-01", { headers: H });
  console.log("Chiqim 5 dona:", chq.d.no, "| qoldi:", st3.d[0].qty, "(kutilgan 50)");
  const tooMuch = await j("/api/docs", { method: "POST", headers: H, body: JSON.stringify({ type: "chiqim", lines: [{ item_id: st3.d[0].item_id, stock_id: st3.d[0].id, location_id: st3.d[0].location_id, cell_row: st3.d[0].cell_row, cell_col: st3.d[0].cell_col, qty: 9999 }] }) });
  await j("/api/docs/" + tooMuch.d.id + "/confirm", { method: "POST", headers: H });
  console.log("Ombordan ko'p chiqim rad etildi:", (await j("/api/docs/" + tooMuch.d.id, { headers: H })).d.status);

  /* --- BEKOR QILISH --- */
  const beforeCancel = (await j("/api/stocks?q=T-01", { headers: H })).d[0].qty;
  await j("/api/docs/" + chq.d.id + "/cancel", { method: "POST", headers: H });
  const afterCancel = (await j("/api/stocks?q=T-01", { headers: H })).d[0].qty;
  console.log("Chiqimni bekor qilish: " + beforeCancel + " -> " + afterCancel + " (kutilgan 55)");

  /* --- KO'CHIRISH --- */
  const to = locs.d[0].cells[0];
  const mv = await j("/api/docs", { method: "POST", headers: H, body: JSON.stringify({ type: "ko'chirish", note: "Test ko'chirish", lines: [{ item_id: st2.d[0].item_id, stock_id: st2.d[0].id, location_id: st2.d[0].location_id, cell_row: st2.d[0].cell_row, cell_col: st2.d[0].cell_col, qty: 20, to_location_id: locs.d[0].id, to_cell_row: to.row, to_cell_col: to.col }] }) });
  await j("/api/docs/" + mv.d.id + "/confirm", { method: "POST", headers: H });
  const mvDoc = (await j("/api/docs/" + mv.d.id, { headers: H })).d;
  console.log("Ko'chirish:", mv.d.no, "|", mvDoc.lines[0].loc_code + "-" + mvDoc.lines[0].cell_row + "-" + mvDoc.lines[0].cell_col, "->", mvDoc.lines[0].to_loc_code + "-" + mvDoc.lines[0].to_cell_row + "-" + mvDoc.lines[0].to_cell_col, "| 20 dona");

  /* --- INVENTARIZATSIYA --- */
  const cnt = await j("/api/counts", { method: "POST", headers: H, body: JSON.stringify({ location_id: blank ? blank.id : locs.d[0].id, note: "Test inventarizatsiya" }) });
  console.log("Sessiya:", cnt.d.no, "|", cnt.d.lines, "pozitsiya");
  const cDet = await j("/api/counts/" + cnt.d.id, { headers: H });
  const first = cDet.d.lines[0];
  await j("/api/counts/" + cnt.d.id + "/lines/" + first.id, { method: "PUT", headers: H, body: JSON.stringify({ actual_qty: first.system_qty + 7 }) });
  const closed = await j("/api/counts/" + cnt.d.id + "/close", { method: "POST", headers: H });
  console.log("Yopildi: farq", closed.d.diffs, "qator | hujjat", closed.d.doc.no);
  const cDet2 = await j("/api/counts/" + cnt.d.id, { headers: H });
  console.log("Tizimdagi", first.system_qty, "-> haqiqiy", cDet2.d.lines[0].actual_qty, "| farq", cDet2.d.lines[0].diff);

  /* --- YO'QOTISH --- */
  const yq = await j("/api/docs", { method: "POST", headers: H, body: JSON.stringify({ type: "yo'qotish", note: "Muddati o'tgan", lines: [{ item_id: st2.d[0].item_id, stock_id: st2.d[0].id, location_id: st2.d[0].location_id, cell_row: st2.d[0].cell_row, cell_col: st2.d[0].cell_col, qty: 3 }] }) });
  await j("/api/docs/" + yq.d.id + "/confirm", { method: "POST", headers: H });
  console.log("Yo'qotish:", yq.d.no, "| qoldi:", (await j("/api/stocks?q=T-01", { headers: H })).d[0].qty);

  /* --- HARAKATLAR --- */
  const mv2 = await j("/api/movements", { headers: H });
  console.log("Harakatlar:", mv2.d.length, "ta | oxirgi:", mv2.d[0].doc_type, mv2.d[0].item_name, mv2.d[0].direction, mv2.d[0].qty, "qoldiq", mv2.d[0].balance_after);

  /* --- CHIZMA --- */
  const map = await j("/api/map", { headers: H });
  console.log("Chizma: zona", map.d.zones.join(","), "| joy", map.d.locations.length, "| dona", map.d.total_qty, "| ogohlantirish", map.d.alerts.length);

  /* --- HISOBOT --- */
  const bal = await j("/api/report/balance", { headers: H });
  const turn = await j("/api/report/turnover", { headers: H });
  console.log("Qoldiq hisoboti:", bal.d.rows.length, "qator |", bal.d.sum_qty, "dona |", bal.d.sum_value, "so'm");
  console.log("Aylanma:", turn.d.length, "ta tovar | kirim", turn.d[0].kirim, "chiqim", turn.d[0].chiqim);
  const noAuth = await j("/api/items");
  console.log("Ruxsatsiz kirish rad etildi:", noAuth.status === 401);
})();

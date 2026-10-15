# Graph Report - whatsapp-bot  (2026-09-20)

## Corpus Check
- Large corpus: 73 files · ~757,356 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 968 nodes · 1898 edges · 46 communities (45 shown, 1 thin omitted)
- Extraction: 84% EXTRACTED · 15% INFERRED · 1% AMBIGUOUS · INFERRED: 291 edges (avg confidence: 0.85)
- Token cost: 639,102 input · 0 output

## Community Hubs (Navigation)
- Shopee Seller Centre Automation
- Ongkir Command and Maps Links
- Video Noise Reduction Engines
- Cek Kilo and Bilas API
- Command Triggers and Mentions
- Maxim App Driver on Emulator
- Auto Rekap Orchestration
- Finance Spreadsheet Ledger
- Package Manifest and Dependencies
- Bot Entry Point Wiring
- AI Expense Note Parsing
- Styrofoam Box Price List
- Latest Price Lookup and Product Map
- Colored Tape Box Price List
- Feature Rationale and Engine Choices
- Business Day and Rekap Trigger
- Ice Pack Price List
- Thermal Bag Price List
- Google Sheets API Client
- PE Foam Price List
- Shopee Price Sync
- Shopee OAuth Token Store
- Cek Kilo Sheet Writer
- VoiceCleaner Web Automation
- Styrofoam Sheet Price List
- Plastic Pallet Price List
- Product Name Alias Rules
- Shopee Price Import
- Sales Book Photo Reading
- Order Recap Message Parser
- Message Filters and Dispatch
- Bot Output Detection
- Ice Gel Price List
- Styrofoam Cutter Price List
- Recap Summary Expense Parser
- Styrofoam Glue Price List
- QRIS Payment Asset
- Shopee Price Mapping CLI
- Keyword Reply Matching
- Offline Deposit Parsing
- Welcome Menu Message
- Recap Image Rendering
- Payment Reply Flow
- Location Reply Flow
- Video Job Queue
- Welcome Trigger Words

## God Nodes (most connected - your core abstractions)
1. `start()` - 28 edges
2. `Katalog & Daftar Harga Box Sterofoam` - 20 edges
3. `performWithdraw()` - 17 edges
4. `writeDailyLedger()` - 16 edges
5. `businessYmd()` - 15 edges
6. `withdrawShopeeBalance()` - 15 edges
7. `normalizeWhatsAppId()` - 15 edges
8. `Sterofoam Box Lakban Warna + Aluminium (product line)` - 14 edges
9. `runKeuanganJob()` - 13 edges
10. `checkOngkir()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Pencocokan label saldo (baris persis)` --semantically_similar_to--> `selectors`  [INFERRED] [semantically similar]
  README.md → src/video/voiceCleanerClient.js
- `Noise reduction video` --references--> `triggerRules`  [EXTRACTED]
  README.md → src/video/videoNoiseTrigger.js
- `Engine voicecleaner.ai` --references--> `selectors`  [EXTRACTED]
  README.md → src/video/voiceCleanerClient.js
- `WPPConnect di atas Puppeteer/Chromium` --semantically_similar_to--> `Penarikan dana lewat Seller Centre, bukan API`  [INFERRED] [semantically similar]
  UBUNTU.md → README.md
- `Otomasi aplikasi Maxim di MuMuPlayer` --conceptually_related_to--> `Ubuntu Server Setup`  [INFERRED]
  README.md → UBUNTU.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Engine denoise yang bisa ditukar lewat VIDEO_DENOISE_ENGINE** — readme_noise_reduction_video, readme_deepfilternet, readme_arnndn, readme_afftdn, readme_voicecleaner_ai, src_video_videonoisetrigger_triggerrules [EXTRACTED 1.00]
- **Alur auto rekap harian: Shopee -> grup -> sheet -> balasan** — readme_auto_rekap, readme_shopee_seller_centre_puppeteer, readme_setoran_offline_grup, readme_batas_hari_kerja, readme_buku_jurnal_spreadsheet, readme_penulisan_idempoten, src_keuangan_keuanganhandler [EXTRACTED 1.00]
- **Pipeline ambil:harga -> map:harga -> sync:harga** — readme_sinkronisasi_harga_shopee, readme_tab_harga_shopee, readme_alur_mapping_harga, src_sheets_hargaterbarualiases, src_shopee_shopeeproductmap, readme_autorisasi_shopee [EXTRACTED 1.00]
- **Two-column pricing matrix: each variant carries a size plus a Lakban Warna and a Lakban Warna + Aluminium price** — assets_pl_box_warna_ukuran_luar_box, assets_pl_box_warna_tier_lakban_warna, assets_pl_box_warna_tier_lakban_warna_aluminium, assets_pl_box_warna_box_lakban_warna_aluminium [EXTRACTED 1.00]
- **Kg-rated box series (5/10/30/35/60 kg) forming the numeric capacity ladder of the catalog** — assets_pl_box_warna_var_box_5_kg, assets_pl_box_warna_var_box_10_kg, assets_pl_box_warna_var_box_30_kg, assets_pl_box_warna_var_box_35_kg, assets_pl_box_warna_var_box_60_kg [INFERRED 0.95]
- **Named (non-kg) model series sold by trade name rather than capacity** — assets_pl_box_warna_var_garuda_75_bs, assets_pl_box_warna_var_garuda_keras, assets_pl_box_warna_var_wawan_besar, assets_pl_box_warna_var_wawan_kecil, assets_pl_box_warna_var_box_tanggung, assets_pl_box_warna_var_panjang_biasa [INFERRED 0.85]
- **Three-tier finishing pricing (Polos / Lakban Coklat / + Aluminium) applied uniformly to every box SKU** — assets_pl_box_varian_polos, assets_pl_box_varian_lakban_coklat, assets_pl_box_varian_lakban_coklat_aluminium, assets_pl_box_katalog_harga_box_sterofoam [EXTRACTED 1.00]
- **Kilogram-named size ladder (5/10/30/35/60 kg) as customer-facing sizing vocabulary** — assets_pl_box_box_5_kg, assets_pl_box_box_10_kg, assets_pl_box_box_30_kg, assets_pl_box_box_35_kg, assets_pl_box_box_60_kg, assets_pl_box_ukuran_pxlxt [INFERRED 0.85]
- **Trade-name box models (Garuda, Wawan, Tanggung, Panjang) sold alongside the kg-numbered line** — assets_pl_box_garuda_75_bs, assets_pl_box_garuda_keras, assets_pl_box_wawan_besar, assets_pl_box_wawan_kecil, assets_pl_box_box_tanggung, assets_pl_box_panjang_biasa [INFERRED 0.85]
- **Eight-tier ice pack price ladder (Rp15,000-Rp45,000, all 3 cm thick)** — assets_pl_ice_pack_variant_22x30x3, assets_pl_ice_pack_variant_15x22x3, assets_pl_ice_pack_variant_15x19_5x3, assets_pl_ice_pack_variant_9x22x3, assets_pl_ice_pack_variant_15x15x3, assets_pl_ice_pack_variant_12x17x3, assets_pl_ice_pack_variant_10x15x3, assets_pl_ice_pack_variant_9x11x3, assets_pl_ice_pack_eight_sizes [EXTRACTED 1.00]
- **Struktur harga per ukuran Lem Sterofoam (100 ml vs 500 ml)** — assets_pl_lem_sterofoam_product, assets_pl_lem_sterofoam_varian_100ml, assets_pl_lem_sterofoam_varian_500ml, assets_pl_lem_sterofoam_image [EXTRACTED 1.00]
- **Price matrix: sheet size x thickness x purchase mode** — assets_pl_lembaran_size_05x1m, assets_pl_lembaran_size_1x2m, assets_pl_lembaran_thickness_tiers, assets_pl_lembaran_harga_ecer, assets_pl_lembaran_harga_bundling_4pcs [EXTRACTED 1.00]
- **Semarang fulfillment via Grab/Gojek with fast-delivery promise** — assets_pl_lembaran_pengiriman_semarang, assets_pl_lembaran_kurir_grab_gojek, assets_pl_lembaran_selling_points, assets_pl_lembaran_bot_price_reply [INFERRED 0.85]
- **Three PE Foam catalog categories priced in one list: Lembaran, Pipa/Silinder, Balok** — assets_pl_pe_foam_lembaran, assets_pl_pe_foam_pipa, assets_pl_pe_foam_balok, assets_pl_pe_foam_image [EXTRACTED 1.00]
- **Sheet thickness ladder 1/2/3/5 cm priced across Ecer and Bundling 4pcs tiers** — assets_pl_pe_foam_lembaran_tebal_1cm, assets_pl_pe_foam_lembaran_tebal_2cm, assets_pl_pe_foam_lembaran_tebal_3cm, assets_pl_pe_foam_lembaran_tebal_5cm, assets_pl_pe_foam_tier_ecer, assets_pl_pe_foam_tier_bundling_4pcs [EXTRACTED 1.00]
- **Tersedia 3 Model Pilihan (variant/price tier set)** — assets_pl_pemotong_sterofoam_model_pisau_kawat_segitiga, assets_pl_pemotong_sterofoam_model_pensil_solder_10cm, assets_pl_pemotong_sterofoam_model_pensil_solder_25cm, assets_pl_pemotong_sterofoam_product [EXTRACTED 1.00]
- **Customer payment request answered with static QRIS card** — assets_qris_payment_reply_flow, assets_qris_image, assets_qris_merchant, assets_qris_scan_pay_instructions [INFERRED 0.85]

## Communities (46 total, 1 thin omitted)

### Community 0 - "Shopee Seller Centre Automation"
Cohesion: 0.07
Nodes (68): Alur Tarik Dana dan PIN 6 digit, npm run cek:menu (pencarian URL halaman saldo), Gerbang kata sandi halaman Saldo Saya, gotoStable (navigasi dicoba ulang), Pencocokan label saldo (baris persis), Login pertama Seller Centre (manual, OTP), Verifikasi identitas Shopee (IVS), collectLinks() (+60 more)

### Community 1 - "Ongkir Command and Maps Links"
Cohesion: 0.06
Nodes (64): { checkOngkir }, { expandLinks }, { formatRupiah }, fs, main(), path, { resolveOrigin, listOrigins }, expandLinks() (+56 more)

### Community 2 - "Video Noise Reduction Engines"
Cohesion: 0.06
Nodes (56): ref_fs, ref_path, buildVariants(), { findWindows, measureRms, measureTilt, runFfmpeg }, fs, main(), modelDir, path (+48 more)

### Community 3 - "Cek Kilo and Bilas API"
Cohesion: 0.06
Nodes (54): ref_crypto, BilasError, createBilasClient(), ensureSession(), getTransactions(), login(), resolveOutlet(), crypto (+46 more)

### Community 4 - "Command Triggers and Mentions"
Cohesion: 0.06
Nodes (51): ref_os, botIsMentioned(), getKiloCommand(), getMentionedIds(), getQuotedMessageId(), getRawCommandText(), hasMentions(), hasTrigger() (+43 more)

### Community 5 - "Maxim App Driver on Emulator"
Cohesion: 0.14
Nodes (39): ref_child_process, ref_util, checkOngkir(), cleanText(), ensureCity(), ensureMaximOpen(), findCityDialogButton(), getPointButtons() (+31 more)

### Community 6 - "Auto Rekap Orchestration"
Cohesion: 0.09
Nodes (34): Auto rekap pemasukan & pengeluaran harian, Batas hari kerja (rekap lewat tengah malam), Rekap pesanan grup, Ringkasan otomatis ke grup lain, buildReply(), { collectAiExpenses }, { collectJualanIncome }, { collectManualExpenses, collectOfflineIncome } (+26 more)

### Community 7 - "Finance Spreadsheet Ledger"
Cohesion: 0.12
Nodes (30): Bentuk spreadsheet: buku jurnal, bukan satu baris per hari, Penarikan menggantung (timeout 120 detik), Tiga pengaman penarikan dana, Menjalankan perintah dua kali (penulisan idempoten), diffLabeledExpenses(), diffOfflineAmounts(), findDayBlock(), { getAccessToken } (+22 more)

### Community 8 - "Package Manifest and Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, @anthropic-ai/bedrock-sdk, dotenv, nodemon, @wppconnect-team/wppconnect, description, engines, node (+20 more)

### Community 9 - "Bot Entry Point Wiring"
Cohesion: 0.09
Nodes (22): { buildRecapFromMessages }, { config: recapSummaryConfig, sendRecapSummary }, configuredRecapFormat, { createBilasClient }, { createJobQueue }, { createWelcomeListOptions, createWelcomeMessage, menuItems }, { createWelcomeStore }, { findLocationReply } (+14 more)

### Community 10 - "AI Expense Note Parsing"
Cohesion: 0.15
Nodes (21): amountAppearsInText(), { AnthropicBedrock }, buildHandledPatterns(), buildUserMessage(), { businessYmd }, collectAiExpenses(), config, { config: summaryConfig } (+13 more)

### Community 11 - "Styrofoam Box Price List"
Cohesion: 0.13
Nodes (21): Price List Image: Styrofoam Box Catalog, Box 10 kg - 51x34x16 - Rp38.000 / Rp43.000 / Rp108.000, Unnamed box 26x17x27 - Rp52.000 / Rp57.000 / Rp102.000, Box 30 kg - 37x29x32 - Rp45.000 / Rp50.000 / Rp115.000, Box 35 kg - 50x37x32 - Rp50.000 / Rp60.000 / Rp125.000, Box 5 kg - 39x25x16 - Rp32.000 / Rp37.000 / Rp82.000, Box 60 kg - 68x47x40 - Rp85.000 / Rp95.000 / Rp180.000, Box Tanggung - 33x24x30 - Rp35.000 / Rp40.000 / Rp85.000 (+13 more)

### Community 12 - "Latest Price Lookup and Product Map"
Cohesion: 0.17
Nodes (19): findDimension(), findInSection(), getBoxLookup(), getHargaTerbaruSheetName(), { getSheetValues }, isNumeric(), loadHargaTerbaru(), normalizeDimension() (+11 more)

### Community 13 - "Colored Tape Box Price List"
Cohesion: 0.14
Nodes (20): Bot price-list reply asset (WhatsApp auto-reply image), Sterofoam Box Lakban Warna + Aluminium (product line), Price List Image: Katalog & Daftar Harga Box Warna, Pengiriman Semarang (delivery coverage), Price tier: Lakban Warna (colored tape only), Price tier: Lakban Warna + Aluminium (tape + foil lining), Ukuran Luar Box (outer dimensions P x L x T, cm), Box 10 kg - 51x34x16 - Rp50,000 / Rp114,000 (+12 more)

### Community 14 - "Feature Rationale and Engine Choices"
Cohesion: 0.13
Nodes (20): Engine afftdn (DSP klasik), Engine arnndn (RNNoise), npm run banding:noise (bandingkan sumber mana pun), Cek kilo (foto catatan vs report Bilas), Cek ongkir (tarif pengiriman Maxim), Engine DeepFilterNet, Plafon matematis parameter mix, Noise reduction video (+12 more)

### Community 15 - "Business Day and Rekap Trigger"
Cohesion: 0.21
Nodes (18): businessYmd(), getCutoffHour(), hourInTimeZone(), isValidYmd(), labelYmd(), MONTHS_ID, shiftYmd(), ymdInTimeZone() (+10 more)

### Community 16 - "Ice Pack Price List"
Cohesion: 0.13
Nodes (19): Bot Price-List Image Reply (pl-* asset), Cara Pakai Baca Deskripsi Produk (usage note), Katalog & Daftar Harga Ice Pack, Cold-Chain Packaging Use Case, Dash Mall (seller brand watermark), Tersedia 8 Ukuran (8 size tiers), Grab / Gojek Instant Delivery Channels, Ice Pack Price List Image (pl-ice-pack.jpg) (+11 more)

### Community 17 - "Thermal Bag Price List"
Cohesion: 0.15
Nodes (19): Cake Bag (category 3, 4 sizes), Cake Bag Large 30x30x25 - Rp44.000, Cake Bag Medium 26x26x20 - Rp37.000, Cake Bag Reguler 25x19x13 - Rp33.000, Cake Bag XXL 30x30x35 - Rp56.000, Thermal Bag Catalog & Price List Image, Lunch Bag (category 1, 4 sizes), Lunch Bag Ekstra Small 27x12x11 - Rp28.000 (+11 more)

### Community 18 - "Google Sheets API Client"
Cohesion: 0.23
Nodes (18): applyShopeeReferencePrices(), clearShopeePriceRows(), crypto, encodeBase64Url(), getAccessToken(), getRecapOutput(), getSheetValues(), getShopeePriceRows() (+10 more)

### Community 19 - "PE Foam Price List"
Cohesion: 0.16
Nodes (18): PE Balok (foam block), Bot price-list reply asset (assets/pl-*.jpg sent to WhatsApp customers), Busa Karangan Bunga 20x10 cm tebal 5 cm - Ecer Rp9.000, Dash Mall (seller brand watermark), Katalog & Daftar Harga PE Foam (price-list image), PE Foam Lembaran 0,5 x 1 meter (sheet), Lembaran tebal 1 cm - Ecer Rp36.000 / Bundling 4pcs Rp108.000, Lembaran tebal 2 cm - Ecer Rp72.000 / Bundling 4pcs Rp216.000 (+10 more)

### Community 20 - "Shopee Price Sync"
Cohesion: 0.20
Nodes (16): { buildSyncReport, syncShopeePrices }, applyUpdates(), buildStatusText(), buildSyncReport(), chunk(), { createShopeeClient }, delay(), fetchItemInfo() (+8 more)

### Community 21 - "Shopee OAuth Token Store"
Cohesion: 0.21
Nodes (15): { buildAuthorizeUrl, exchangeAuthCode, TOKEN_PATH }, [code, shopIdOverride], buildAuthorizeUrl(), createShopeeClient(), crypto, DATA_DIR, exchangeAuthCode(), fs (+7 more)

### Community 22 - "Cek Kilo Sheet Writer"
Cohesion: 0.21
Nodes (15): buildFormatRequests(), buildRows(), buildTrxUrl(), callSheets(), findSheetId(), { getAccessToken }, getSheetName(), HEADERS (+7 more)

### Community 23 - "VoiceCleaner Web Automation"
Cohesion: 0.21
Nodes (14): cleanAudio(), clickButton(), clickInnermost(), config, fs, listFiles(), login(), markWorkspace() (+6 more)

### Community 24 - "Styrofoam Sheet Price List"
Cohesion: 0.20
Nodes (15): Bot Price-List Reply Asset, Bundle Discount Logic (4pcs cheaper than 4x ecer), Dash Mall (Brand Watermark on Product Photo), Bundling 4pcs Pricing, Ecer (Retail Single-Piece) Pricing, Price List Image: Sterofoam Lembaran, Grab & Gojek Courier Channels, Pengiriman Semarang (Semarang Delivery Area) (+7 more)

### Community 25 - "Plastic Pallet Price List"
Cohesion: 0.19
Nodes (15): Beban Dinamis +/-1.000 kg, Beban Statis +/-4.000 kg, Aset Balasan Price List Bot WhatsApp, Dash Mall (brand toko), Harga Rp195.000 (single price tier), Palet Plastik Price-List Flyer (image), Klaim Ramah Lingkungan / 100% Dapat Didaur Ulang, Klaim Tahan Air & Anti Rayap (+7 more)

### Community 26 - "Product Name Alias Rules"
Cohesion: 0.19
Nodes (14): Cara mapping harga bekerja, Autorisasi Shopee (token store), Sinkronisasi Harga Shopee (CLI), Struktur tab Harga Shopee, ALIAS_RULES, compactNumbers(), firstDimensionPair(), firstNumber() (+6 more)

### Community 27 - "Shopee Price Import"
Cohesion: 0.21
Nodes (13): { buildImportReport, importShopeePrices }, buildImportReport(), buildModelName(), chunk(), { createShopeeClient }, fetchAllItemIds(), { formatSyncTime }, getItemStatuses() (+5 more)

### Community 28 - "Sales Book Photo Reading"
Cohesion: 0.20
Nodes (14): { AnthropicBedrock }, { businessYmd }, collectJualanIncome(), config, extractJsonObject(), getClient(), { getMessageTimestampMs, parseIndonesianNumber }, { isBotGeneratedMessage } (+6 more)

### Community 29 - "Order Recap Message Parser"
Cohesion: 0.24
Nodes (11): buildRecapFromMessages(), ITEM_PATTERN, ITEM_UNITS, MONTH_NAMES, normalizeProductName(), normalizeRecapDate(), parseRecapMessage(), parseRecapPart() (+3 more)

### Community 30 - "Message Filters and Dispatch"
Cohesion: 0.24
Nodes (11): getMessageIdentity(), getMessageTimestampMs(), getRecapDateLabel(), isBlockedChatMessage(), isGroupMessage(), isHistoricalMessage(), isStatusBroadcastMessage(), rememberGroupMessage() (+3 more)

### Community 31 - "Bot Output Detection"
Cohesion: 0.27
Nodes (9): BOT_TEXT_PATTERNS, isBotGeneratedMessage(), isBotGeneratedText(), isRememberedBotMessage(), rememberBotMessage(), rememberedIds, SEND_METHODS, serializeId() (+1 more)

### Community 32 - "Ice Gel Price List"
Cohesion: 0.31
Nodes (10): WhatsApp bot price-list reply asset, Dash Mall (seller brand on price list), Kondisi baru (belum beku) - sold unfrozen, Bisa kirim via Grab / Gojek, Ice Gel Price List Image (Dash Mall), Ice Gel (Icegelku dry ice gel pack), Cara Penggunaan: rendam 3 menit, freezer bagian bawah plastik, tahan approx 9 jam, Pengiriman dingin dan packing (seafood, frozen food, dessert) (+2 more)

### Community 33 - "Styrofoam Cutter Price List"
Cohesion: 0.36
Nodes (10): Dash Mall (Shop Brand), Delivery via Grab / Gojek, Price List Image: Sterofoam Cutter, Model 2: Pensil Solder 10 cm - Rp158.000, Model 3: Pensil Solder 25 cm - Rp190.000, Model 1: Pisau Kawat Segitiga - Rp70.000, WhatsApp Bot Price-List Reply Asset, Pemotong Sterofoam (Styrofoam Cutter) (+2 more)

### Community 34 - "Recap Summary Expense Parser"
Cohesion: 0.31
Nodes (9): getMessageTimestampMs(), parseIndonesianNumber(), { businessYmd }, collectRecapExpenses(), { config: summaryConfig }, { getMessageTimestampMs, parseIndonesianNumber }, matchLabeledAmount(), normalizeLabel() (+1 more)

### Community 35 - "Styrofoam Glue Price List"
Cohesion: 0.33
Nodes (9): Dash Mall (Brand / Toko), Price List Image: Lem Sterofoam, Kegunaan: Packing & Kerajinan, Keunggulan: Daya Rekat Kuat, Cairan Jernih & Tidak Berbau, Praktis, Pengiriman via Grab / Gojek, WhatsApp Bot Price-List Reply Asset (pl-*.jpg), Lem Sterofoam (Styrofoam Glue), Lem Sterofoam 100 ml - Rp22.000 (+1 more)

### Community 36 - "QRIS Payment Asset"
Cohesion: 0.46
Nodes (8): GPN / ASPI QRIS Scheme Branding, QRIS Payment Code Image (qris.jpg), Merchant: Toko Dashmall Sterofoam - Stationary, Merchant Identifier Block (NMID, printer id, print version) - redacted, Bot Payment Reply Flow (send QRIS when customer asks how to pay), QRIS National QR Payment Standard, Scan-and-Pay Instruction Strip (buka aplikasi, scan & cek, bayar), Static Printed Merchant QR Card (terminal label A01)

### Community 37 - "Shopee Price Mapping CLI"
Cohesion: 0.29
Nodes (6): { applyHargaTerbaru, buildMapReport }, {
  applyShopeeReferencePrices,
  getShopeePriceRows,
  updateShopeeMappingColumns,
}, buildMapReport(), { formatPrice }, { loadHargaTerbaru }, { mapShopeeProduct }

### Community 38 - "Keyword Reply Matching"
Cohesion: 0.32
Nodes (7): getIncomingText(), isJobInquiry(), ASSET_DIR, findReply(), normalizeKeyword(), path, replies

### Community 39 - "Offline Deposit Parsing"
Cohesion: 0.33
Nodes (6): Aturan pembacaan nominal tanpa satuan, Setoran offline dari grup, { businessYmd }, { isBotGeneratedMessage }, OFFLINE_PATTERN, PENGELUARAN_PATTERN

### Community 40 - "Welcome Menu Message"
Cohesion: 0.47
Nodes (5): createPrefilledWhatsAppLink(), createWelcomeListOptions(), createWelcomeMessage(), menuItems, normalizePhoneNumber()

### Community 41 - "Recap Image Rendering"
Cohesion: 0.50
Nodes (4): ref_puppeteer, escapeHtml(), puppeteer, renderRecapJpg()

### Community 42 - "Payment Reply Flow"
Cohesion: 0.50
Nodes (4): ASSET_DIR, containsWord(), findPaymentReply(), path

### Community 43 - "Location Reply Flow"
Cohesion: 0.83
Nodes (3): findLocationReply(), normalizeText(), shouldReplyAddress()

### Community 44 - "Video Job Queue"
Cohesion: 0.67
Nodes (3): createJobQueue(), push(), runNext()

## Ambiguous Edges - Review These
- `Sterofoam Box Lakban Warna + Aluminium (product line)` → `Unnamed variant - 26x17x27 - Rp64,000 / Rp109,000 (row label blank)`  [AMBIGUOUS]
  assets/pl-box-warna.jpg · relation: implements
- `Unnamed variant - 26x17x27 - Rp64,000 / Rp109,000 (row label blank)` → `Wawan Kecil - 25x20x28 - Rp41,000 / Rp86,000`  [AMBIGUOUS]
  assets/pl-box-warna.jpg · relation: semantically_similar_to
- `Unnamed box 26x17x27 - Rp52.000 / Rp57.000 / Rp102.000` → `Box Tanggung - 33x24x30 - Rp35.000 / Rp40.000 / Rp85.000`  [AMBIGUOUS]
  assets/pl-box.jpg · relation: semantically_similar_to
- `Super Ice Pack (product)` → `Dash Mall (seller brand watermark)`  [AMBIGUOUS]
  assets/pl-ice-pack.jpg · relation: conceptually_related_to
- `Lem Sterofoam (Styrofoam Glue)` → `Pengiriman via Grab / Gojek`  [AMBIGUOUS]
  assets/pl-lem-sterofoam.jpg · relation: conceptually_related_to
- `Price List Image: Sterofoam Lembaran` → `Dash Mall (Brand Watermark on Product Photo)`  [AMBIGUOUS]
  assets/pl-lembaran.jpg · relation: references
- `Harga Rp195.000 (single price tier)` → `Ukuran 130 x 110 x 15 cm`  [AMBIGUOUS]
  assets/pl-palet-plastik.jpg · relation: conceptually_related_to
- `PE Foam product line` → `Busa Karangan Bunga 20x10 cm tebal 5 cm - Ecer Rp9.000`  [AMBIGUOUS]
  assets/pl-pe-foam.jpg · relation: conceptually_related_to
- `Dash Mall (Shop Brand)` → `WhatsApp Bot Price-List Reply Asset`  [AMBIGUOUS]
  assets/pl-pemotong-sterofoam.jpg · relation: conceptually_related_to
- `Lunch Bag Ekstra Small 27x12x11 - Rp28.000` → `Size-Based Price Tiering (larger size = higher price)`  [AMBIGUOUS]
  assets/pl-thermal-bag.jpg · relation: conceptually_related_to

## Knowledge Gaps
- **282 isolated node(s):** `name`, `version`, `description`, `main`, `start` (+277 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 315 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Sterofoam Box Lakban Warna + Aluminium (product line)` and `Unnamed variant - 26x17x27 - Rp64,000 / Rp109,000 (row label blank)`?**
  _Edge tagged AMBIGUOUS (relation: implements) - confidence is low._
- **What is the exact relationship between `Unnamed variant - 26x17x27 - Rp64,000 / Rp109,000 (row label blank)` and `Wawan Kecil - 25x20x28 - Rp41,000 / Rp86,000`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Unnamed box 26x17x27 - Rp52.000 / Rp57.000 / Rp102.000` and `Box Tanggung - 33x24x30 - Rp35.000 / Rp40.000 / Rp85.000`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Super Ice Pack (product)` and `Dash Mall (seller brand watermark)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Lem Sterofoam (Styrofoam Glue)` and `Pengiriman via Grab / Gojek`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Price List Image: Sterofoam Lembaran` and `Dash Mall (Brand Watermark on Product Photo)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Harga Rp195.000 (single price tier)` and `Ukuran 130 x 110 x 15 cm`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
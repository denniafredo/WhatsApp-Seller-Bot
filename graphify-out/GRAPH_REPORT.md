# Graph Report - whatsapp-bot  (2026-10-15)

## Corpus Check
- 74 files · ~771,036 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .rnnn 4, (none) 3, .example 1)

## Summary
- 1141 nodes · 2186 edges · 57 communities (56 shown, 1 thin omitted)
- Extraction: 84% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 336 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ee2c5062`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- shopeeWithdrawClient.js
- Ongkir Command and Maps Links
- videoNoiseAbCli.js
- kiloHandler.js
- videoNoiseHandler.js
- mumuClient.js
- keuanganHandler.js
- keuanganSheet.js
- package.json
- index.js
- aiPengeluaranParser.js
- Styrofoam Box Price List
- Latest Price Lookup and Product Map
- Colored Tape Box Price List
- kiloTrigger.js
- Business Day and Rekap Trigger
- Ice Pack Price List
- Thermal Bag Price List
- googleSheets.js
- PE Foam Price List
- shopeePriceSync.js
- Shopee OAuth Token Store
- Cek Kilo Sheet Writer
- VoiceCleaner Web Automation
- Styrofoam Sheet Price List
- Plastic Pallet Price List
- Product Name Alias Rules
- Shopee Price Import
- jualanParser.js
- Order Recap Message Parser
- Message Filters and Dispatch
- Bot Output Detection
- Ice Gel Price List
- Styrofoam Cutter Price List
- pengeluaranParser.js
- Styrofoam Glue Price List
- QRIS Payment Asset
- shopeePriceMap.js
- Keyword Reply Matching
- offlineParser.js
- Welcome Menu Message
- notaHandler.js
- squeezeSchedule.js
- Location Reply Flow
- Video Job Queue
- Welcome Trigger Words
- dashmall.js
- videoNoiseReduction.js
- ref_path
- kiloCompare.js
- notaParser.js
- bilasClient.js
- notaRender.js
- kiloPhotoReader.js
- reduceNoise
- notaBrands.js
- paymentReplies.js

## God Nodes (most connected - your core abstractions)
1. `start()` - 31 edges
2. `Katalog & Daftar Harga Box Sterofoam` - 20 edges
3. `writeDailyLedger()` - 18 edges
4. `normalizeWhatsAppId()` - 18 edges
5. `performWithdraw()` - 17 edges
6. `withdrawShopeeBalance()` - 17 edges
7. `Sterofoam Box Lakban Warna + Aluminium (product line)` - 14 edges
8. `runKeuanganJob()` - 13 edges
9. `OngkirError` - 13 edges
10. `checkOngkir()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Pencocokan label saldo (baris persis)` --semantically_similar_to--> `selectors`  [INFERRED] [semantically similar]
  README.md → src/video/voiceCleanerClient.js
- `Engine voicecleaner.ai` --references--> `selectors`  [EXTRACTED]
  README.md → src/video/voiceCleanerClient.js
- `Noise reduction video` --references--> `triggerRules`  [EXTRACTED]
  README.md → src/video/videoNoiseTrigger.js
- `WPPConnect di atas Puppeteer/Chromium` --semantically_similar_to--> `Penarikan dana lewat Seller Centre, bukan API`  [INFERRED] [semantically similar]
  UBUNTU.md → README.md
- `Otomasi aplikasi Maxim di MuMuPlayer` --conceptually_related_to--> `Ubuntu Server Setup`  [INFERRED]
  README.md → UBUNTU.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Alur auto rekap harian: Shopee -> grup -> sheet -> balasan** — readme_auto_rekap, readme_shopee_seller_centre_puppeteer, readme_setoran_offline_grup, readme_batas_hari_kerja, readme_buku_jurnal_spreadsheet, readme_penulisan_idempoten, src_keuangan_keuanganhandler [EXTRACTED 1.00]
- **Three-tier finishing pricing (Polos / Lakban Coklat / + Aluminium) applied uniformly to every box SKU** — assets_pl_box_varian_polos, assets_pl_box_varian_lakban_coklat, assets_pl_box_varian_lakban_coklat_aluminium, assets_pl_box_katalog_harga_box_sterofoam [EXTRACTED 1.00]
- **Two-column pricing matrix: each variant carries a size plus a Lakban Warna and a Lakban Warna + Aluminium price** — assets_pl_box_warna_ukuran_luar_box, assets_pl_box_warna_tier_lakban_warna, assets_pl_box_warna_tier_lakban_warna_aluminium, assets_pl_box_warna_box_lakban_warna_aluminium [EXTRACTED 1.00]
- **Eight-tier ice pack price ladder (Rp15,000-Rp45,000, all 3 cm thick)** — assets_pl_ice_pack_variant_22x30x3, assets_pl_ice_pack_variant_15x22x3, assets_pl_ice_pack_variant_15x19_5x3, assets_pl_ice_pack_variant_9x22x3, assets_pl_ice_pack_variant_15x15x3, assets_pl_ice_pack_variant_12x17x3, assets_pl_ice_pack_variant_10x15x3, assets_pl_ice_pack_variant_9x11x3, assets_pl_ice_pack_eight_sizes [EXTRACTED 1.00]
- **Struktur harga per ukuran Lem Sterofoam (100 ml vs 500 ml)** — assets_pl_lem_sterofoam_product, assets_pl_lem_sterofoam_varian_100ml, assets_pl_lem_sterofoam_varian_500ml, assets_pl_lem_sterofoam_image [EXTRACTED 1.00]
- **Price matrix: sheet size x thickness x purchase mode** — assets_pl_lembaran_size_05x1m, assets_pl_lembaran_size_1x2m, assets_pl_lembaran_thickness_tiers, assets_pl_lembaran_harga_ecer, assets_pl_lembaran_harga_bundling_4pcs [EXTRACTED 1.00]
- **Sheet thickness ladder 1/2/3/5 cm priced across Ecer and Bundling 4pcs tiers** — assets_pl_pe_foam_lembaran_tebal_1cm, assets_pl_pe_foam_lembaran_tebal_2cm, assets_pl_pe_foam_lembaran_tebal_3cm, assets_pl_pe_foam_lembaran_tebal_5cm, assets_pl_pe_foam_tier_ecer, assets_pl_pe_foam_tier_bundling_4pcs [EXTRACTED 1.00]
- **Three PE Foam catalog categories priced in one list: Lembaran, Pipa/Silinder, Balok** — assets_pl_pe_foam_lembaran, assets_pl_pe_foam_pipa, assets_pl_pe_foam_balok, assets_pl_pe_foam_image [EXTRACTED 1.00]
- **Tersedia 3 Model Pilihan (variant/price tier set)** — assets_pl_pemotong_sterofoam_model_pisau_kawat_segitiga, assets_pl_pemotong_sterofoam_model_pensil_solder_10cm, assets_pl_pemotong_sterofoam_model_pensil_solder_25cm, assets_pl_pemotong_sterofoam_product [EXTRACTED 1.00]
- **Engine denoise yang bisa ditukar lewat VIDEO_DENOISE_ENGINE** — readme_noise_reduction_video, readme_deepfilternet, readme_arnndn, readme_afftdn, readme_voicecleaner_ai, src_video_videonoisetrigger_triggerrules [EXTRACTED 1.00]
- **Pipeline ambil:harga -> map:harga -> sync:harga** — readme_sinkronisasi_harga_shopee, readme_tab_harga_shopee, readme_alur_mapping_harga, src_sheets_hargaterbarualiases, src_shopee_shopeeproductmap, readme_autorisasi_shopee [EXTRACTED 1.00]
- **Kilogram-named size ladder (5/10/30/35/60 kg) as customer-facing sizing vocabulary** — assets_pl_box_box_5_kg, assets_pl_box_box_10_kg, assets_pl_box_box_30_kg, assets_pl_box_box_35_kg, assets_pl_box_box_60_kg, assets_pl_box_ukuran_pxlxt [INFERRED 0.85]
- **Trade-name box models (Garuda, Wawan, Tanggung, Panjang) sold alongside the kg-numbered line** — assets_pl_box_garuda_75_bs, assets_pl_box_garuda_keras, assets_pl_box_wawan_besar, assets_pl_box_wawan_kecil, assets_pl_box_box_tanggung, assets_pl_box_panjang_biasa [INFERRED 0.85]
- **Named (non-kg) model series sold by trade name rather than capacity** — assets_pl_box_warna_var_garuda_75_bs, assets_pl_box_warna_var_garuda_keras, assets_pl_box_warna_var_wawan_besar, assets_pl_box_warna_var_wawan_kecil, assets_pl_box_warna_var_box_tanggung, assets_pl_box_warna_var_panjang_biasa [INFERRED 0.85]
- **Semarang fulfillment via Grab/Gojek with fast-delivery promise** — assets_pl_lembaran_pengiriman_semarang, assets_pl_lembaran_kurir_grab_gojek, assets_pl_lembaran_selling_points, assets_pl_lembaran_bot_price_reply [INFERRED 0.85]
- **Customer payment request answered with static QRIS card** — assets_qris_payment_reply_flow, assets_qris_image, assets_qris_merchant, assets_qris_scan_pay_instructions [INFERRED 0.85]
- **Kg-rated box series (5/10/30/35/60 kg) forming the numeric capacity ladder of the catalog** — assets_pl_box_warna_var_box_5_kg, assets_pl_box_warna_var_box_10_kg, assets_pl_box_warna_var_box_30_kg, assets_pl_box_warna_var_box_35_kg, assets_pl_box_warna_var_box_60_kg [INFERRED 0.95]

## Communities (57 total, 1 thin omitted)

### Community 0 - "shopeeWithdrawClient.js"
Cohesion: 0.07
Nodes (70): Alur Tarik Dana dan PIN 6 digit, npm run cek:menu (pencarian URL halaman saldo), Gerbang kata sandi halaman Saldo Saya, gotoStable (navigasi dicoba ulang), Pencocokan label saldo (baris persis), Login pertama Seller Centre (manual, OTP), Verifikasi identitas Shopee (IVS), collectLinks() (+62 more)

### Community 1 - "Ongkir Command and Maps Links"
Cohesion: 0.06
Nodes (64): { checkOngkir }, { expandLinks }, { formatRupiah }, fs, main(), path, { resolveOrigin, listOrigins }, expandLinks() (+56 more)

### Community 2 - "videoNoiseAbCli.js"
Cohesion: 0.16
Nodes (21): buildVariants(), { findWindows, measureRms, measureTilt, runFfmpeg }, fs, main(), modelDir, path, { probeMedia, reduceNoiseWithDeepFilter }, toFilterModel() (+13 more)

### Community 3 - "kiloHandler.js"
Cohesion: 0.12
Nodes (22): c_project_whatsapp_bot_src_kilo_kilotrigger_getkilocommand, c_project_whatsapp_bot_src_kilo_kilotrigger_issupportedimage, c_project_whatsapp_bot_src_shared_progressreporter_createprogressreporter, { BilasError }, buildReply(), { compareKilo }, { createProgressReporter }, describeFailure() (+14 more)

### Community 4 - "videoNoiseHandler.js"
Cohesion: 0.07
Nodes (39): Engine afftdn (DSP klasik), Engine arnndn (RNNoise), npm run banding:noise (bandingkan sumber mana pun), Engine DeepFilterNet, Plafon matematis parameter mix, Noise reduction video, npm run uji:noise (A/B setelan denoise), VIDEO_DENOISE_POLISH (+31 more)

### Community 5 - "mumuClient.js"
Cohesion: 0.15
Nodes (38): ref_util, checkOngkir(), cleanText(), ensureCity(), ensureMaximOpen(), findCityDialogButton(), getPointButtons(), getPointTitle() (+30 more)

### Community 6 - "keuanganHandler.js"
Cohesion: 0.10
Nodes (24): c_project_whatsapp_bot_src_keuangan_keuangantrigger_getkeuangancommand, c_project_whatsapp_bot_src_keuangan_offlineparser_collectmanualexpenses, c_project_whatsapp_bot_src_keuangan_offlineparser_collectofflineincome, c_project_whatsapp_bot_src_keuangan_pengeluaranparser_collectrecapexpenses, c_project_whatsapp_bot_src_shared_recapsummary_resolvesummarygroupid, collectJualanIncome(), buildReply(), { collectAiExpenses } (+16 more)

### Community 7 - "keuanganSheet.js"
Cohesion: 0.11
Nodes (33): Bentuk spreadsheet: buku jurnal, bukan satu baris per hari, Penarikan menggantung (timeout 120 detik), Tiga pengaman penarikan dana, Menjalankan perintah dua kali (penulisan idempoten), deleteRows(), diffLabeledExpenses(), diffOfflineAmounts(), findDayBlock() (+25 more)

### Community 8 - "package.json"
Cohesion: 0.07
Nodes (29): dependencies, @anthropic-ai/bedrock-sdk, dotenv, nodemon, puppeteer, @wppconnect-team/wppconnect, description, engines (+21 more)

### Community 9 - "index.js"
Cohesion: 0.04
Nodes (44): c_project_whatsapp_bot_src_kilo_bilasclient_createbilasclient, c_project_whatsapp_bot_src_kilo_kilohandler_handlekilocommand, c_project_whatsapp_bot_src_ongkir_ongkirhandler_handleongkircommand, c_project_whatsapp_bot_src_replies_keywordreplies_findreply, c_project_whatsapp_bot_src_replies_keywordreplies_normalizekeyword, c_project_whatsapp_bot_src_replies_keywordreplies_replies, c_project_whatsapp_bot_src_replies_locationreplies_findlocationreply, c_project_whatsapp_bot_src_replies_paymentreplies_findpaymentreply (+36 more)

### Community 10 - "aiPengeluaranParser.js"
Cohesion: 0.12
Nodes (23): c_project_whatsapp_bot_src_keuangan_offlineparser_createamountpattern, c_project_whatsapp_bot_src_keuangan_offlineparser_getauthorlabel, c_project_whatsapp_bot_src_keuangan_pengeluaranparser_parsesummarytext, c_project_whatsapp_bot_src_shared_recapsummary_config, amountAppearsInText(), { AnthropicBedrock }, buildHandledPatterns(), buildUserMessage() (+15 more)

### Community 11 - "Styrofoam Box Price List"
Cohesion: 0.13
Nodes (21): Price List Image: Styrofoam Box Catalog, Box 10 kg - 51x34x16 - Rp38.000 / Rp43.000 / Rp108.000, Unnamed box 26x17x27 - Rp52.000 / Rp57.000 / Rp102.000, Box 30 kg - 37x29x32 - Rp45.000 / Rp50.000 / Rp115.000, Box 35 kg - 50x37x32 - Rp50.000 / Rp60.000 / Rp125.000, Box 5 kg - 39x25x16 - Rp32.000 / Rp37.000 / Rp82.000, Box 60 kg - 68x47x40 - Rp85.000 / Rp95.000 / Rp180.000, Box Tanggung - 33x24x30 - Rp35.000 / Rp40.000 / Rp85.000 (+13 more)

### Community 12 - "Latest Price Lookup and Product Map"
Cohesion: 0.17
Nodes (19): findDimension(), findInSection(), getBoxLookup(), getHargaTerbaruSheetName(), { getSheetValues }, isNumeric(), loadHargaTerbaru(), normalizeDimension() (+11 more)

### Community 13 - "Colored Tape Box Price List"
Cohesion: 0.14
Nodes (20): Bot price-list reply asset (WhatsApp auto-reply image), Sterofoam Box Lakban Warna + Aluminium (product line), Price List Image: Katalog & Daftar Harga Box Warna, Pengiriman Semarang (delivery coverage), Price tier: Lakban Warna (colored tape only), Price tier: Lakban Warna + Aluminium (tape + foil lining), Ukuran Luar Box (outer dimensions P x L x T, cm), Box 10 kg - 51x34x16 - Rp50,000 / Rp114,000 (+12 more)

### Community 14 - "kiloTrigger.js"
Cohesion: 0.09
Nodes (39): c_project_whatsapp_bot_src_shared_recapmentionreply_normalizewhatsappid, botIsMentioned(), getKiloCommand(), getMentionedIds(), getQuotedMessageId(), getRawCommandText(), hasMentions(), hasTrigger() (+31 more)

### Community 15 - "Business Day and Rekap Trigger"
Cohesion: 0.21
Nodes (18): businessYmd(), getCutoffHour(), hourInTimeZone(), isValidYmd(), labelYmd(), MONTHS_ID, shiftYmd(), ymdInTimeZone() (+10 more)

### Community 16 - "Ice Pack Price List"
Cohesion: 0.13
Nodes (19): Bot Price-List Image Reply (pl-* asset), Cara Pakai Baca Deskripsi Produk (usage note), Katalog & Daftar Harga Ice Pack, Cold-Chain Packaging Use Case, Dash Mall (seller brand watermark), Tersedia 8 Ukuran (8 size tiers), Grab / Gojek Instant Delivery Channels, Ice Pack Price List Image (pl-ice-pack.jpg) (+11 more)

### Community 17 - "Thermal Bag Price List"
Cohesion: 0.15
Nodes (19): Cake Bag (category 3, 4 sizes), Cake Bag Large 30x30x25 - Rp44.000, Cake Bag Medium 26x26x20 - Rp37.000, Cake Bag Reguler 25x19x13 - Rp33.000, Cake Bag XXL 30x30x35 - Rp56.000, Thermal Bag Catalog & Price List Image, Lunch Bag (category 1, 4 sizes), Lunch Bag Ekstra Small 27x12x11 - Rp28.000 (+11 more)

### Community 18 - "googleSheets.js"
Cohesion: 0.17
Nodes (21): puppeteer, applyShopeeReferencePrices(), clearShopeePriceRows(), crypto, encodeBase64Url(), getAccessToken(), getRecapOutput(), getSheetValues() (+13 more)

### Community 19 - "PE Foam Price List"
Cohesion: 0.16
Nodes (18): PE Balok (foam block), Bot price-list reply asset (assets/pl-*.jpg sent to WhatsApp customers), Busa Karangan Bunga 20x10 cm tebal 5 cm - Ecer Rp9.000, Dash Mall (seller brand watermark), Katalog & Daftar Harga PE Foam (price-list image), PE Foam Lembaran 0,5 x 1 meter (sheet), Lembaran tebal 1 cm - Ecer Rp36.000 / Bundling 4pcs Rp108.000, Lembaran tebal 2 cm - Ecer Rp72.000 / Bundling 4pcs Rp216.000 (+10 more)

### Community 20 - "shopeePriceSync.js"
Cohesion: 0.21
Nodes (15): { buildSyncReport, syncShopeePrices }, applyUpdates(), buildStatusText(), buildSyncReport(), chunk(), { createShopeeClient }, delay(), fetchItemInfo() (+7 more)

### Community 21 - "Shopee OAuth Token Store"
Cohesion: 0.21
Nodes (15): { buildAuthorizeUrl, exchangeAuthCode, TOKEN_PATH }, [code, shopIdOverride], buildAuthorizeUrl(), createShopeeClient(), crypto, DATA_DIR, exchangeAuthCode(), fs (+7 more)

### Community 22 - "Cek Kilo Sheet Writer"
Cohesion: 0.19
Nodes (16): c_project_whatsapp_bot_src_sheets_googlesheets_getaccesstoken, buildFormatRequests(), buildRows(), buildTrxUrl(), callSheets(), findSheetId(), { getAccessToken }, getSheetName() (+8 more)

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

### Community 28 - "jualanParser.js"
Cohesion: 0.15
Nodes (17): c_project_whatsapp_bot_src_keuangan_offlineparser_getmessagetimestampms, { AnthropicBedrock }, { businessYmd }, config, DAY_NAMES_ID, extractJsonObject(), getClient(), { getMessageTimestampMs, parseIndonesianNumber } (+9 more)

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

### Community 34 - "pengeluaranParser.js"
Cohesion: 0.25
Nodes (10): isRecapSummary(), getMessageTimestampMs(), { businessYmd }, collectRecapExpenses(), { config: summaryConfig }, { getMessageTimestampMs, parseIndonesianNumber }, matchLabeledAmount(), normalizeLabel() (+2 more)

### Community 35 - "Styrofoam Glue Price List"
Cohesion: 0.33
Nodes (9): Dash Mall (Brand / Toko), Price List Image: Lem Sterofoam, Kegunaan: Packing & Kerajinan, Keunggulan: Daya Rekat Kuat, Cairan Jernih & Tidak Berbau, Praktis, Pengiriman via Grab / Gojek, WhatsApp Bot Price-List Reply Asset (pl-*.jpg), Lem Sterofoam (Styrofoam Glue), Lem Sterofoam 100 ml - Rp22.000 (+1 more)

### Community 36 - "QRIS Payment Asset"
Cohesion: 0.46
Nodes (8): GPN / ASPI QRIS Scheme Branding, QRIS Payment Code Image (qris.jpg), Merchant: Toko Dashmall Sterofoam - Stationary, Merchant Identifier Block (NMID, printer id, print version) - redacted, Bot Payment Reply Flow (send QRIS when customer asks how to pay), QRIS National QR Payment Standard, Scan-and-Pay Instruction Strip (buka aplikasi, scan & cek, bayar), Static Printed Merchant QR Card (terminal label A01)

### Community 37 - "shopeePriceMap.js"
Cohesion: 0.27
Nodes (8): { applyHargaTerbaru, buildMapReport }, applyHargaTerbaru(), {
  applyShopeeReferencePrices,
  getShopeePriceRows,
  updateShopeeMappingColumns,
}, buildMapReport(), { formatPrice }, { loadHargaTerbaru }, { mapShopeeProduct }, formatPrice()

### Community 38 - "Keyword Reply Matching"
Cohesion: 0.32
Nodes (7): getIncomingText(), isJobInquiry(), ASSET_DIR, findReply(), normalizeKeyword(), path, replies

### Community 39 - "offlineParser.js"
Cohesion: 0.18
Nodes (15): c_project_whatsapp_bot_src_keuangan_businessday_businessymd, Aturan pembacaan nominal tanpa satuan, Setoran offline dari grup, parseBookAmount(), { businessYmd }, collectLabeledAmounts(), collectManualExpenses(), collectOfflineIncome() (+7 more)

### Community 40 - "Welcome Menu Message"
Cohesion: 0.47
Nodes (4): createPrefilledWhatsAppLink(), createWelcomeMessage(), menuItems, normalizePhoneNumber()

### Community 41 - "notaHandler.js"
Cohesion: 0.13
Nodes (23): assetsDir, cache, fs, hasAsset(), path, listAliases(), baseFileName(), brandListText() (+15 more)

### Community 42 - "squeezeSchedule.js"
Cohesion: 0.08
Nodes (36): c_project_whatsapp_bot_src_shared_groupresolver_resolvegroupid, Auto rekap pemasukan & pengeluaran harian, Batas hari kerja (rekap lewat tengah malam), Cek kilo (foto catatan vs report Bilas), Cek ongkir (tarif pengiriman Maxim), Otomasi aplikasi Maxim di MuMuPlayer, Pemendekan alamat dari link Google Maps, Rekap pesanan grup (+28 more)

### Community 43 - "Location Reply Flow"
Cohesion: 0.83
Nodes (3): findLocationReply(), normalizeText(), shouldReplyAddress()

### Community 44 - "Video Job Queue"
Cohesion: 0.67
Nodes (3): createJobQueue(), push(), runNext()

### Community 46 - "dashmall.js"
Cohesion: 0.19
Nodes (21): escapeHtml(), optionalDataUri(), formatNumber(), bankLines(), { formatNumber }, iconPhone(), iconPin(), itemRows() (+13 more)

### Community 47 - "videoNoiseReduction.js"
Cohesion: 0.10
Nodes (18): attenLimitDb, deepFilterPostFilterBeta, defaultEngine, defaultMix, defaultNoiseReduction, defaultTimeoutMs, engines, escapeFilterValue() (+10 more)

### Community 48 - "ref_path"
Cohesion: 0.14
Nodes (13): ref_child_process, ref_fs, ref_path, createWelcomeStore(), DATA_DIR, fs, loadWelcomedChats(), path (+5 more)

### Community 49 - "kiloCompare.js"
Cohesion: 0.26
Nodes (15): assignPairs(), charSimilarity(), compareKilo(), DIGIT_LOOKALIKE, editDistance(), foldName(), HONORIFICS, isEligible() (+7 more)

### Community 50 - "notaParser.js"
Cohesion: 0.21
Nodes (14): c_project_whatsapp_bot_src_keuangan_offlineparser_parseindonesiannumber, c_project_whatsapp_bot_src_keuangan_offlineparser_torupiah, isRealDate(), labelYmd(), limits, matchField(), MONTHS_ID, pad() (+6 more)

### Community 51 - "bilasClient.js"
Cohesion: 0.23
Nodes (11): ref_crypto, BilasError, createBilasClient(), ensureSession(), getTransactions(), login(), resolveOutlet(), crypto (+3 more)

### Community 52 - "notaRender.js"
Cohesion: 0.20
Nodes (12): chain, closeBrowser(), config, getBrowser(), isAlive(), puppeteer, { renderNotaHtml }, renderOnce() (+4 more)

### Community 53 - "kiloPhotoReader.js"
Cohesion: 0.33
Nodes (9): { AnthropicBedrock }, BASE_PROMPT, buildNameHint(), buildPrompt(), coerceKilo(), extractJsonArray(), getClient(), KiloReadError (+1 more)

### Community 54 - "reduceNoise"
Cohesion: 0.44
Nodes (9): buildAudioFilter(), buildPostFilters(), NoiseReductionError, pickAudioBitRate(), probeMedia(), reduceNoise(), reduceNoiseWithDeepFilter(), reduceNoiseWithVoiceCleaner() (+1 more)

### Community 55 - "notaBrands.js"
Cohesion: 0.43
Nodes (7): buildDashMall(), builders, buildMarvel(), env(), envList(), listBrands(), resolveBrand()

### Community 56 - "paymentReplies.js"
Cohesion: 0.50
Nodes (4): ASSET_DIR, containsWord(), findPaymentReply(), path

## Ambiguous Edges - Review These
- `Unnamed box 26x17x27 - Rp52.000 / Rp57.000 / Rp102.000` → `Box Tanggung - 33x24x30 - Rp35.000 / Rp40.000 / Rp85.000`  [AMBIGUOUS]
  assets/pl-box.jpg · relation: semantically_similar_to
- `Sterofoam Box Lakban Warna + Aluminium (product line)` → `Unnamed variant - 26x17x27 - Rp64,000 / Rp109,000 (row label blank)`  [AMBIGUOUS]
  assets/pl-box-warna.jpg · relation: implements
- `Unnamed variant - 26x17x27 - Rp64,000 / Rp109,000 (row label blank)` → `Wawan Kecil - 25x20x28 - Rp41,000 / Rp86,000`  [AMBIGUOUS]
  assets/pl-box-warna.jpg · relation: semantically_similar_to
- `Dash Mall (seller brand watermark)` → `Super Ice Pack (product)`  [AMBIGUOUS]
  assets/pl-ice-pack.jpg · relation: conceptually_related_to
- `Lunch Bag Ekstra Small 27x12x11 - Rp28.000` → `Size-Based Price Tiering (larger size = higher price)`  [AMBIGUOUS]
  assets/pl-thermal-bag.jpg · relation: conceptually_related_to
- `Busa Karangan Bunga 20x10 cm tebal 5 cm - Ecer Rp9.000` → `PE Foam product line`  [AMBIGUOUS]
  assets/pl-pe-foam.jpg · relation: conceptually_related_to
- `Dash Mall (Brand Watermark on Product Photo)` → `Price List Image: Sterofoam Lembaran`  [AMBIGUOUS]
  assets/pl-lembaran.jpg · relation: references
- `Harga Rp195.000 (single price tier)` → `Ukuran 130 x 110 x 15 cm`  [AMBIGUOUS]
  assets/pl-palet-plastik.jpg · relation: conceptually_related_to
- `Dash Mall (Shop Brand)` → `WhatsApp Bot Price-List Reply Asset`  [AMBIGUOUS]
  assets/pl-pemotong-sterofoam.jpg · relation: conceptually_related_to
- `Pengiriman via Grab / Gojek` → `Lem Sterofoam (Styrofoam Glue)`  [AMBIGUOUS]
  assets/pl-lem-sterofoam.jpg · relation: conceptually_related_to

## Knowledge Gaps
- **331 isolated node(s):** `name`, `version`, `description`, `main`, `start` (+326 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 394 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Unnamed box 26x17x27 - Rp52.000 / Rp57.000 / Rp102.000` and `Box Tanggung - 33x24x30 - Rp35.000 / Rp40.000 / Rp85.000`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Sterofoam Box Lakban Warna + Aluminium (product line)` and `Unnamed variant - 26x17x27 - Rp64,000 / Rp109,000 (row label blank)`?**
  _Edge tagged AMBIGUOUS (relation: implements) - confidence is low._
- **What is the exact relationship between `Unnamed variant - 26x17x27 - Rp64,000 / Rp109,000 (row label blank)` and `Wawan Kecil - 25x20x28 - Rp41,000 / Rp86,000`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Dash Mall (seller brand watermark)` and `Super Ice Pack (product)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Lunch Bag Ekstra Small 27x12x11 - Rp28.000` and `Size-Based Price Tiering (larger size = higher price)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Busa Karangan Bunga 20x10 cm tebal 5 cm - Ecer Rp9.000` and `PE Foam product line`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Dash Mall (Brand Watermark on Product Photo)` and `Price List Image: Sterofoam Lembaran`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
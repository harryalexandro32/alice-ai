# Panduan dashboard Alice AI

Panduan ini untuk staf yang memakai dashboard. Judul bagiannya mengikuti nama menu dan judul kartu di dashboard, supaya mudah dicari dengan kata yang sama. Panel **Bantuan** (tombol tanda tanya di kanan bawah) menjawab pertanyaan hanya dari panduan ini. Hal yang tidak ada di sini berarti belum bisa dilakukan dari dashboard; pertanyaan seperti itu dicatat untuk developer.

## Gambaran umum

- Alice AI adalah asisten penjualan WhatsApp. Bot menyapa pelanggan baru, mengumpulkan data pelanggan (lead), menjawab pertanyaan dari data produk, mengirim foto, PDF, dan link marketplace, lalu meneruskan ke staf kalau tidak tahu jawabannya.
- Dashboard adalah tempat mengatur bot tanpa menyentuh kode. Alamatnya: https://alice.lukicenturi.com. Masuk dengan kata sandi dashboard (satu kata sandi untuk semua pengguna). Sesi berlaku 12 jam.
- Satu **proyek** = satu bisnis = satu nomor WhatsApp. GFAN Indonesia adalah proyek `gfan`. Pemilih proyek ada di atas menu samping.
- Semua perubahan di halaman Pengetahuan bot dan Pengaturan baru berlaku setelah tombol **Simpan dan terapkan** di bilah bawah ditekan (atau Ctrl+S / Cmd+S). Bot memakai pengaturan baru mulai pesan berikutnya, tanpa dinyalakan ulang.
- Bahasa dashboard: tombol **ID / EN** di bawah menu samping. Bot sendiri selalu membalas pelanggan dalam bahasa Indonesia.
- Tema terang atau gelap: tombol bulan/matahari di bilah atas.
- **Cari** (tombol Cari di bilah atas, Ctrl+K, Cmd+K, atau tombol `/`): satu kotak untuk mencari halaman, bagian halaman, percakapan (nama, nomor 08… atau +62…), produk, proyek lain, dan aksi (tema, bahasa, Coba chat, Bantuan).
- **Bilah keadaan** di atas tiap halaman: WhatsApp tersambung atau belum, **Bot dijeda**, **Mode uji**, LLM belum diatur, dan perkiraan biaya bulan ini (LLM + cek resi). Tiap lencana adalah tautan ke pengaturannya.
- Tiap halaman punya alamat sendiri yang bisa disimpan atau dibagikan, misalnya `/gfan/conversations` atau `/gfan/settings/whatsapp`.
- Di layar HP, menu samping menjadi laci: buka dengan tombol menu di kiri atas.

## Menu samping

Menu dibagi tiga kelompok:

- **Ringkasan**: Beranda, Percakapan, Pesanan.
- **Pengetahuan bot**: Cara bot bicara, Produk, Brosur.
- **Pengaturan**: Umum, WhatsApp, Notifikasi, Tokopedia & Shop, Lanjutan.

Di bawah menu ada tombol bahasa (ID / EN) dan **Keluar**.

## Beranda

Alamat: `/gfan`. Ringkasan 7 hari terakhir.

- **Angka**: empat kotak angka 7 hari terakhir (percakapan baru, pesan, lead, dan pelanggan yang butuh staf) dan dua grafik harian.
- **Tahap lead**: semua kontak menurut tahapnya. Klik satu tahap untuk membuka daftar Percakapan yang sudah disaring ke tahap itu.
- **Perlu perhatian**: pelanggan yang menunggu staf dan masalah bot dalam 24 jam terakhir (WhatsApp terputus, kiriman dijeda, balasan gagal, LLM bermasalah, bot berhenti, cek resi). Klik barisnya untuk membuka percakapan dan membalas dari dashboard.
- **Pertanyaan yang belum terjawab**: 5 pertanyaan terbaru yang diteruskan bot ke staf karena tidak tahu jawabannya. "Lihat semua" membuka daftar lengkapnya di Pengetahuan bot › Produk.

## Percakapan

Alamat: `/gfan/conversations`. Semua calon pelanggan yang pernah chat dengan bot.

- **Cari**: kotak cari di atas tabel mencari nomor, nama, kota, kebutuhan, ringkasan, dan catatan.
- **Saringan tahap**: tombol di bawah kotak cari (Semua, Baru, Menunggu tim, Dihubungi, Link terkirim, Pembayaran, Barang terkirim, Pesanan selesai, Batal, Perlu staf). Arahkan kursor ke satu saringan untuk membaca arti tahapnya.
- **Unduh CSV**: mengunduh semua lead sebagai berkas CSV untuk Excel. Urutan kolomnya mengikuti urutan "Data yang dikumpulkan" di Cara bot bicara.
- **Impor pelanggan lama**: tempel nomor pelanggan yang sudah dikenal, satu nomor per baris, boleh ditambah koma dan nama (contoh `081234567890, Pak Budi`). Saat mereka chat, bot melewati perkenalan dan sudah tahu namanya. Centang "Bot tidak membalas nomor-nomor ini" kalau staf yang akan menangani mereka. Mengimpor nomor yang sama lagi hanya memperbaruinya.
- Angka merah di menu Percakapan = jumlah pelanggan yang sedang menunggu staf.
- Klik satu baris untuk membuka percakapannya.

### Tahap lead

Tiap pelanggan punya satu tahap. Tahap tidak pernah turun sendiri.

- **Baru**: belum ada staf yang ikut membalas. Bot masih melayani sendiri.
- **Menunggu tim**: bot sudah meneruskan percakapan ke tim, dan belum ada staf yang membalas. Berubah sendiri saat bot menyerahkan chat.
- **Dihubungi**: staf sudah membalas pelanggan ini, dari HP atau dari dashboard, atau menandai "Sudah ditangani". Berubah sendiri.
- **Link terkirim**: bot sudah mengirim link Tokopedia atau Shopee. Berubah sendiri.
- **Pembayaran**: pelanggan sedang membayar atau sudah membayar. Dipasang staf dari kotak Tahap di halaman percakapan, atau otomatis oleh pesanan dari toko Tokopedia & Shop yang ditautkan saat pesanannya dibayar.
- **Barang terkirim**: barang sudah dikirim. Dipasang staf, atau otomatis oleh cek resi atau pesanan toko saat paket sudah di jalan.
- **Pesanan selesai**: pelanggan sudah menerima barang. Dipasang staf, atau otomatis oleh cek resi atau pesanan toko saat paket diterima.
- **Batal**: pelanggan tidak jadi membeli. Hanya staf yang memasangnya. Cek resi dan pesanan toko tidak menyentuh tahap ini.

Tanda **Perlu staf** bukan tahap. Tanda ini muncul saat bot meminta bantuan staf, di tahap apa pun, dan hilang saat staf membalas atau menandai "Sudah ditangani".

## Satu percakapan

Alamat: `/gfan/conversations/+62…`. Dibuka dengan klik satu baris di Percakapan, atau dari Perlu perhatian di Beranda. Tombol panah kiri di atas judul kembali ke daftar.

- **Menunggu staf** (kotak kuning di atas): tampil saat bot meminta bantuan tim di chat ini. Hilang saat Anda membalas. Kalau sudah ditangani di luar chat, misalnya lewat telepon, klik **Tandai sudah ditangani**.
- **Tahap**: pilih tahap pelanggan dari kotak pilihan. Langsung tersimpan.
- **Bot menjawab** (tombol saklar): mati = staf yang menangani chat ini, bot diam. Nyala = bot kembali membalas, semua penahan dilepas. Berlaku seketika. Di sebelahnya tertulis alasan bot diam, kalau ada (admin membalas dari HP, pelanggan minta berhenti, jam tenang).
- **Data pelanggan**: isian lead yang dikumpulkan bot (nama, kota, kebutuhan, dan lainnya sesuai "Data yang dikumpulkan"), dan **Ringkasan percakapan** yang ditulis LLM.
- **Catatan**: catatan bebas untuk tim, misalnya "minta penawaran hari Senin". Tersimpan otomatis beberapa detik setelah selesai mengetik.
- **Pesanan**: kolom **Nomor pesanan**, **Nomor resi**, dan **Kurir**. Bot mengisi sendiri nomor pesanan (id 18 digit Tokopedia atau TikTok Shop, atau nomor invoice `INV/…`) dan nomor resi yang ditempel pelanggan di chat, hanya ke kolom yang masih kosong. Staf bisa mengubahnya. Tombol **Cek resi** menanyakan status kurir sekarang. Bot juga mengecek sendiri tiap 5 menit, paling sering sekali per 30 menit per resi, selama 30 hari sejak resi diisi. Status "paket di jalan" menaikkan tahap ke Barang terkirim, "paket diterima" ke Pesanan selesai. Status retur, batal, hilang, atau rusak tampil sebagai "Bermasalah" dan tidak mengubah tahap. Status sebelum paket diambil kurir tampil sebagai "Menunggu kurir". Di bawahnya ada riwayat status dan tautan ke situs kurir. Kalau cek resi otomatis belum diatur di server, kolomnya tetap bisa diisi dan tautannya tetap ada. Kalau nomor pesanan cocok dengan pesanan dari toko Tokopedia & Shop yang ditautkan, status, waktu bayar, dan total pesanannya tampil di atas kolom pesanan, dan resi serta kurir terisi sendiri.
- **Riwayat chat**: semua pesan, pelanggan di kiri, bot dan admin di kanan. Pesan yang dikutip pelanggan tampil di atas pesannya. Gulung ke atas untuk memuat pesan lama.
- **Balas dari web**: tulis balasan di kotak bawah, lalu klik **Kirim** atau tekan Ctrl+Enter (Enter = baris baru). Balasan dikirim dari nomor bot dalam sekitar 3 detik selama WhatsApp tersambung. Setelah Anda membalas, bot berhenti membalas di percakapan ini, sama seperti saat Anda membalas dari HP. Balasan yang gagal 5 kali tampil "gagal terkirim" dan masuk Perlu perhatian.
- Pelanggan hasil impor yang belum pernah chat ke nomor bot belum bisa dibalas dari sini. Balas dari aplikasi WhatsApp.

## Pesanan

Alamat: `/gfan/orders`. Menu Ringkasan › Pesanan. Pesanan dari toko Tokopedia & Shop yang ditautkan di Pengaturan › Tokopedia & Shop. Tanpa toko yang ditautkan, halaman ini kosong.

- **Cari**: nomor pesanan, nama penerima, atau nama barang.
- **Saringan**: Semua, Belum bayar, Perlu dikirim, Dikirim, Selesai, Batal, Belum tertaut.
- Tiap baris: nomor pesanan dan platform, barang, status, waktu bayar, total, nomor resi dan kurir, dan percakapan yang tertaut.
- Pesanan dicocokkan ke percakapan **hanya lewat nomor pesanan**, karena marketplace menyamarkan nama dan nomor pembeli. Nomor pesanan yang ditempel pelanggan di chat, atau yang diisi staf di kolom Nomor pesanan percakapan, langsung menautkan pesanannya.
- **Tautkan**: ketik nomor WhatsApp pelanggan (+62…) di baris pesanan, lalu klik Tautkan. **Lepas** melepas tautannya.
- Pesanan yang tertaut dan sudah dibayar mengisi resi dan kurir percakapannya dan menaikkan tahap: dibayar = Pembayaran, di jalan = Barang terkirim, sampai = Pesanan selesai. Pesanan batal tidak mengubah tahap.
- Angka merah di menu Pesanan = pesanan yang sudah dibayar tapi belum tertaut ke percakapan.
- Pesanan masuk lewat webhook dan sinkron tiap 15 menit. Tombol **Sinkron sekarang** ada di Pengaturan › Tokopedia & Shop.

## Cara bot bicara

Alamat: `/gfan/knowledge/behavior`. Menu Pengetahuan bot › Cara bot bicara. Semua isian di halaman ini tersimpan lewat **Simpan dan terapkan**. Tombol **Coba chat** di bilah keadaan menguji hasilnya tanpa mengirim apa pun ke WhatsApp.

- **Siapa yang menjawab**: nama bisnis, nama admin (alias, misalnya "Rina", kosongkan kalau tidak perlu), peran (misalnya "admin penjualan GFAN Indonesia"), sapaan ke pelanggan ("Bapak/Ibu" atau "Kak"), tentang bisnis (satu dua kalimat), dan **Logo** (JPG, PNG, atau WebP, maksimal 4 MB; tampil di pemilih proyek). Logo berganti setelah disimpan.
- **Pembukaan**: **Salam pembuka** dikirim sekali pada pesan pertama dan sebaiknya sudah meminta semua data di "Data yang dikumpulkan". **Salam kalau namanya sudah diketahui** dipakai saat nama profil WhatsApp pelanggan tampak seperti nama orang; `{nama}` diganti nama itu. **Data yang dikumpulkan**: tabel isian lead (kunci, label, pertanyaan). Kunci ditulis huruf kecil tanpa spasi. Centang "Nama" di baris yang berisi nama pelanggan. Urutan baris = urutan di ringkasan ke sales dan di unduhan CSV. Minimal 1 baris, maksimal 8. Setelah semua data terisi, bot mengirim ringkasannya ke penerima notifikasi "Lead baru".
- **Pertanyaan dan rekomendasi**: **Yang ditanyakan bot** adalah daftar pertanyaan sebelum bot menyarankan produk (maksimal 12; bot hanya menanyakan yang belum dijawab, paling banyak dua per pesan). **Cara bot menganalisis dan menyarankan**: tulis seperti mengajari karyawan baru, rumus, angka acuan, dan produk mana untuk keadaan apa.
- **Gaya dan aturan balasan** (lipatan): satu aturan per baris, maksimal 20. Nada yang disukai, hal yang harus dihindari, contoh kalimat, hal yang langsung dikerjakan tanpa bertanya.
- **Pelajaran dari percakapan** (lipatan): arti satu jenis pesan pelanggan dan yang harus dilakukan bot, maksimal 40. Biasanya ditambahkan lewat tombol **Ajari bot** di Pertanyaan yang belum terjawab. Bot membaca semua pelajaran pada tiap balasan.
- **Yang harus dijawab manusia** (lipatan): **Topik** yang selalu diteruskan ke tim (bot menjawab "tim kami yang akan menginfokan" lalu mengabari staf), **Sebutan di notifikasi**, dan centang **Bot hanya boleh menyebut harga yang tertulis di daftar produk** (balasan yang menyebut harga lain tidak dikirim).

## Produk

Alamat: `/gfan/knowledge/products`. Menu Pengetahuan bot › Produk. Bot tidak menjawab hal yang tidak tertulis di halaman ini, di Brosur, atau di Cara bot bicara.

- **Daftar produk**: satu baris untuk satu produk, maksimal 300. Kolom: nama (kode model), keterangan, harga, stok, foto (maksimal 6 per produk, klik ikon foto untuk mengunggah), PDF, dan link Tokopedia dan Shopee. Isi harga dan stok supaya bot bisa menjawabnya; kalau kosong, bot meneruskan pertanyaan itu ke tim. Baris bisa ditempel langsung dari Excel (pilih satu sel, lalu tempel). Tombol **Tambah produk** di bawah tabel. Ikon tempat sampah menghapus baris.
- **Link marketplace**: klik ikon Tokopedia atau Shopee di baris produk, tempel link produk dari situs marketplace itu (harus diawali `https://`). Saat pelanggan ingin membeli produk itu, bot mengirim linknya sebagai pesan tersendiri, dan tahap pelanggan pindah ke Link terkirim.
- **Data teknis rinci (opsional)** (lipatan): tabel spesifikasi per kelompok produk (watt, aliran udara, ukuran) yang bisa dikutip bot dengan tepat. **Tambah kelompok** membuat kelompok baru dengan catatan dan tabel. Hapus kelompoknya kalau PDF saja sudah cukup.
- **Pertanyaan yang belum terjawab**: semua pertanyaan yang diteruskan bot ke staf, dikelompokkan kalau beberapa pelanggan menanyakan hal yang sama, dengan pesan bot sebelum dan sesudahnya. Tiga pilihan per pertanyaan:
  - **Tambahkan ke pengetahuan**: tulis jawabannya sekali. Tanya jawab itu masuk ke "Pengetahuan lain", dan bot bisa menjawabnya mulai pesan berikutnya.
  - **Ajari bot**: kalau bot salah paham maksud pesannya, tulis artinya dan yang harus dilakukan bot. **Bantu jelaskan** meminta LLM menjelaskan kenapa pesan itu diteruskan dan mengusulkan pelajarannya. **Coba lagi** menjalankan ulang balasan dengan pelajaran yang belum disimpan. Pelajaran yang disimpan masuk ke "Pelajaran dari percakapan" di Cara bot bicara.
  - **Abaikan**: pertanyaan dihapus dari daftar.
- **Pengetahuan lain**: teks bebas untuk hal yang bukan tabel: tanya jawab umum, jam buka, cara pesan, ongkir, garansi. Centang **Tolak kode produk yang tidak ada di data ini** supaya balasan yang menyebut kode produk karangan tidak dikirim.

## Brosur

Alamat: `/gfan/knowledge/brochures`. Menu Pengetahuan bot › Brosur.

- **Brosur dan katalog**: **Unggah PDF** (maksimal 4 MB per berkas). Dashboard membaca isinya, mencari nama produk di dalamnya, lalu memasangkan PDF itu ke produk tersebut. Satu PDF bisa untuk banyak produk. Bot bisa mengirim PDF ini ke pelanggan di WhatsApp.
- **Dibaca bot** (centang per PDF): bot boleh menjawab dari isi PDF itu. Tabel di PDF bisa terbaca bergeser, jadi uji dulu lewat Coba chat. Makin banyak PDF yang dibaca, makin mahal tiap balasan.
- **Cocokkan ulang semua**: memasangkan ulang semua PDF ke produk yang belum punya PDF. PDF hasil pindai (gambar halaman) tidak bisa dibaca; pasangkan sendiri lewat kolom PDF di Daftar produk.
- Hapus PDF dengan ikon tempat sampah. Simpan dulu perubahan lain sebelum menghapus.

## Coba chat dengan bot

Tombol **Coba chat** ada di bilah keadaan di semua halaman. Panelnya terbuka di sisi kanan.

- Ketik pesan seperti calon pelanggan. Bot membalas memakai profil yang **sudah disimpan**. Tidak ada pesan yang dikirim ke WhatsApp.
- Di bawah tiap balasan tampil niat yang dikenali bot, data lead yang tercatat, dan jumlah lampiran. Balasan yang ditolak pagar keamanan (harga karangan, kode produk karangan, tautan) tampil kuning dengan alasannya.
- **Mulai ulang** mengosongkan percakapan uji.
- Kalau ada perubahan yang belum disimpan, jawabannya masih memakai profil lama.

## Pengaturan › Umum

Alamat: `/gfan/settings`.

- **Proyek**: saklar **Bot dijeda di semua percakapan** langsung berlaku. Pesan tetap dicatat, tapi bot tidak membalas dan tidak mengirim follow-up sampai jeda dimatikan. **Nama proyek**, **Jalur WhatsApp** (Baileys dengan QR atau kode pairing, atau Cloud API Meta), dan **Proyek aktif** (kalau dimatikan, server menghentikan bot proyek ini) tersimpan lewat Simpan dan terapkan.
- **Saat admin manusia ikut membalas**: centang **Bot berhenti setelah admin manusia membalas** supaya bot keluar dari chat itu untuk seterusnya setelah staf membalas (dari HP atau dashboard), sampai bot dinyalakan lagi di percakapannya. Kalau tidak dicentang, bot hanya diam selama jumlah jam yang diisi (bawaan 12 jam).
- **Follow-up**: pengingat otomatis kalau pelanggan berhenti membalas. **Kapan dikirim**: setelah pelanggan diam X sampai Y jam (dipilih acak per pelanggan), hanya di antara jam tertentu, maksimal N kali per pelanggan (0 = tidak ada follow-up). **Isi pesan**: "Sesuai percakapan" (LLM menulis pengingat sesuai isi chat, dengan **Kalimat cadangan** kalau LLM tidak tersedia) atau "Kalimat tetap" (satu kalimat penutup yang sama). Follow-up tidak dikirim ke pelanggan yang minta berhenti atau yang botnya dimatikan. Lipatan **Cara kerjanya** di bawah kartu menjelaskan aturan jamnya.
- **Pengaturan lain**: pintasan ke WhatsApp dan Notifikasi.
- **Lanjutan** (lipatan): pintasan ke pengaturan lanjutan.

## Pengaturan › WhatsApp

Alamat: `/gfan/settings/whatsapp`.

- **Tautkan WhatsApp**: menautkan nomor bot dari dashboard, tanpa terminal. Di HP nomor bot: WhatsApp › Perangkat tertaut › Tautkan perangkat, lalu pindai QR yang tampil. Atau isi nomor bot, klik **Minta kode pairing**, lalu di HP pilih "Tautkan dengan nomor telepon saja" dan ketik 8 huruf kodenya. Setelah tersambung, yang tampil hanya "Tersambung sebagai <nomor>". **Putuskan dan tautkan ulang** untuk mengganti nomor. Jangan sering memutus dan menautkan ulang, karena itu menaikkan risiko nomor diblokir WhatsApp.
- **Keadaan bot**: laporan terakhir bot: jalur, model LLM, jatah panggilan LLM hari ini, mode uji, pengaman nomor (batas kiriman, pemanasan antiban, kiriman yang ditahan), dan pengaturan yang sedang berlaku. Kunci API dan kata sandi tidak diatur dari dashboard; itu ada di `.env` di server dan hanya developer yang bisa mengubahnya.
- HP nomor bot harus tetap menyala dan tersambung internet (jalur Baileys).

## Pengaturan › Notifikasi

Alamat: `/gfan/settings/notifications`.

- **Penerima**: pemilik dan staf yang dikabari bot lewat WhatsApp. Tiap baris: nama, peran (Pemilik atau Staf), nomor WhatsApp (0812…, atau `self` untuk nomor bot sendiri). Maksimal 20 penerima. **Tambah penerima** menambah baris. Simpan lewat Simpan dan terapkan.
- Nomor penerima tidak pernah dianggap pelanggan. Jangan daftarkan nomor yang dipakai untuk mencoba bot sebagai pelanggan.
- **Kirim pesan tes**: mengirim pesan tes dari nomor bot ke tiap penerima yang sudah tersimpan.
- **Notifikasi mana untuk siapa**: tiap jenis notifikasi (Lead baru, Pelanggan butuh staf, LLM bermasalah, Cek resi) bisa diarahkan ke pemilik, staf, keduanya, atau tidak dikirim. Bawaan: lead baru dan pelanggan butuh staf ke staf, LLM dan cek resi ke pemilik. Kalau tidak ada penerima dengan peran itu, semua penerima mendapatkannya.
- Notifikasi soal WhatsApp itu sendiri (terputus, kiriman dijeda, balasan dashboard gagal) dan bot berhenti tidak bisa lewat WhatsApp. Itu hanya tampil di Beranda (Perlu perhatian) dan di Pengaturan › Lanjutan › Riwayat warning.

## Pengaturan › Tokopedia & Shop

Alamat: `/gfan/settings/marketplace`. Menautkan toko Tokopedia (dijalankan TikTok Shop) supaya status pembayaran, nomor resi, dan kurir tiap pesanan masuk sendiri ke dashboard. Shopee belum didukung.

- **Tautan toko**: kalau fitur belum menyala, halaman ini menjelaskan bahwa developer harus mengisi kunci aplikasi TikTok Shop di server. Kalau sudah menyala, klik **Tautkan toko**: pemilik toko masuk dengan akun Seller Center, lalu menyetujui akses pesanan. Halaman izin hanya berlaku sekali selama 30 menit; kalau kedaluwarsa, klik Tautkan toko lagi. Untuk aplikasi pribadi toko (seller developer), tempel kode izinnya di kolom **Tautkan dengan kode**.
- Setelah tertaut, kartu ini menampilkan status (Aktif, Kedaluwarsa, Dicabut), nama toko, penjual, masa berlaku token dan izin, sinkron terakhir, dan jumlah pesanan 30 hari. **Sinkron sekarang** menarik pesanan terbaru. **Putuskan tautan** menghentikan pesanan baru; pesanan yang sudah masuk tetap tersimpan.
- Satu toko hanya bisa tertaut ke satu proyek. Kalau toko mencabut izin aplikasi, tautan dan pesanannya dihapus, dan pemilik mendapat warning "Tokopedia & Shop".
- **Alamat webhook**: alamat yang diisi sekali di Partner Center oleh developer, supaya perubahan pesanan langsung masuk.

## Pengaturan › Lanjutan

Alamat: `/gfan/settings/advanced`. Kotak angka yang kosong memakai nilai bawaan server (tampil abu-abu). Kebanyakan bisnis tidak perlu mengubah halaman ini.

- **Mode uji**: kalau diisi nomor (dipisah koma), bot **hanya** melayani nomor-nomor itu dan mengabaikan nomor lain. Berguna saat mencoba bot di nomor yang sudah punya pelanggan sungguhan. Kosongkan untuk melayani semua orang. Saat aktif, bilah keadaan menampilkan lencana Mode uji.
- **Batas dan pengaman**: kiriman WhatsApp per menit, per jam, per 24 jam; panggilan LLM per hari; pesan per pelanggan per hari; jeda penggabungan pesan beruntun (ms). Kalau batas per menit terlewati, kiriman masuk antrean; kalau batas per jam atau per hari terlewati, bot berhenti mengirim sampai waktunya lewat. **Nomor baru: pemanasan 7 hari**: matikan kalau nomor sudah lama dipakai normal.
- **Balasan**: lama bot "berpikir" sebelum membalas (paling cepat dan paling lama, detik, dipilih acak), **Jam tenang** (bot tidak membalas di jam itu, pesan dibalas setelah jam tenang selesai, follow-up tidak dikirim), **Analisis foto kiriman pelanggan** (foto dikirim ke LLM supaya bot bisa menyarankan produk dari foto), dan **Ubah pesan suara jadi teks** (butuh kunci STT di server). Kalau analisis foto atau suara dimatikan, bot hanya menerima kirimannya dan mengabari staf.
- **Pemakaian dan biaya LLM**: biaya dan jumlah panggilan LLM per hari, dengan pilihan rentang 7, 30, atau 90 hari, grafik, dan tabel. Tarif token (USD per 1 juta) dan kurs bisa diubah di sini. Biayanya perkiraan; tagihan resmi ada di akun penyedia LLM.
- **Pemakaian dan biaya cek resi**: jumlah cek resi ke Binderbyte per hari (otomatis dan manual), perkiraan biaya, saldo, dan sisa kuota gratis akun Binderbyte. Rentang waktunya mengikuti kartu LLM.
- **Riwayat warning** (lipatan): semua warning yang pernah dicatat bot: pelanggan butuh staf, WhatsApp terputus, kiriman dijeda, balasan gagal terkirim, LLM bermasalah, bot berhenti, cek resi, Tokopedia & Shop.
- **Catatan error** (lipatan): error dan warning dari proses bot, yang terbaru di atas. Untuk developer.

## Proyek baru

Pilih **＋ Proyek baru…** di pemilih proyek (atas menu samping). Isi id (singkat, huruf kecil, dipakai di alamat web, misalnya `toko-budi`), nama, dan profil awal (`generic` mulai dari kosong, `gfan` menyalin data produk GFAN). Server menyalakan bot proyek baru dalam sekitar 1 menit. Setelah itu tautkan WhatsApp-nya di Pengaturan › WhatsApp dan isi penerima di Pengaturan › Notifikasi.

## Bantuan

Tombol tanda tanya di kanan bawah membuka panel Bantuan. Tab **Tanya**: tulis pertanyaan tentang dashboard, jawabannya diambil dari panduan ini. Tab **Panduan**: panduan lengkap ini untuk dibaca sendiri. Pertanyaan yang tidak terjawab dicatat untuk developer.

## Yang tidak bisa dilakukan dari dashboard

- Mengubah kunci API (LLM, Binderbyte, STT), kata sandi dashboard, atau alamat server. Semuanya di `.env` server, hanya developer.
- Mengirim pesan WhatsApp ke nomor yang belum pernah chat ke bot (siaran atau broadcast).
- Melihat pesanan Shopee. Pesanan Tokopedia & Shop masuk kalau tokonya ditautkan di Pengaturan › Tokopedia & Shop; selain itu bot hanya mencatat nomor pesanan dan resi yang ditempel pelanggan di chat.
- Menyalakan tautan toko Tokopedia & Shop tanpa developer: kunci aplikasi TikTok Shop diisi di server.
- Menghapus percakapan atau pelanggan.
- Menambah pengguna dashboard dengan kata sandi berbeda. Satu kata sandi dipakai bersama.
- Mengubah bahasa balasan bot. Bot selalu membalas dalam bahasa Indonesia.

## Masalah umum

- **Bot tidak membalas pelanggan**: periksa bilah keadaan. "WhatsApp belum tertaut" atau "Bot tidak melapor": buka Pengaturan › WhatsApp. "Bot dijeda": matikan jeda di Pengaturan › Umum › Proyek. "Mode uji": nomor pelanggan tidak ada di daftar mode uji (Pengaturan › Lanjutan). Di satu percakapan: saklar **Bot menjawab** mati, atau admin baru membalas dari HP (bot diam sesuai Pengaturan › Umum). Jam tenang aktif (Pengaturan › Lanjutan › Balasan).
- **Bot menjawab salah atau tidak tahu**: tambahkan datanya di Produk (Daftar produk, Data teknis rinci, Pengetahuan lain) atau jawab di Pertanyaan yang belum terjawab. Kalau bot salah paham maksud pesan, pakai Ajari bot. Uji lewat Coba chat.
- **Bot menyebut harga atau kode yang salah**: isi harga di Daftar produk, nyalakan "Bot hanya boleh menyebut harga yang tertulis di daftar produk" (Cara bot bicara › Yang harus dijawab manusia) dan "Tolak kode produk yang tidak ada di data ini" (Produk › Pengetahuan lain).
- **Perubahan tidak berlaku**: tekan **Simpan dan terapkan** di bilah bawah. Perubahan berlaku mulai pesan berikutnya.
- **Balasan dari web gagal terkirim**: WhatsApp harus tersambung. Lihat Pengaturan › WhatsApp. Balasan dicoba ulang sampai 5 kali.
- **Notifikasi tidak masuk**: periksa Pengaturan › Notifikasi: nomor penerima, peran, dan "Notifikasi mana untuk siapa". Klik Kirim pesan tes.
- **Biaya LLM tinggi**: lihat Pengaturan › Lanjutan › Pemakaian dan biaya LLM. Kurangi PDF yang "Dibaca bot" di Brosur, atau turunkan batas panggilan LLM per hari.

## Catatan untuk developer

Berkas ini (`src/admin/bantuan.md`) adalah satu-satunya sumber jawaban panel Bantuan. Setiap kali fitur dashboard ditambah, diubah, atau dihapus, perbarui berkas ini di perubahan yang sama. Tes `src/admin/admin.test.ts` gagal kalau ada judul kartu, lipatan, atau menu di `page.html` yang tidak disebut di sini. Pertanyaan staf yang tidak terjawab tercatat di `<DATA_DIR>/bantuan-belum-terjawab.jsonl` di server; baca berkas itu sesekali dan lengkapi panduannya.

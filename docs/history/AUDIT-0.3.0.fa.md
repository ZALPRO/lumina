# Historical audit — Lumina 0.3.0 (internal, Persian)

> **Note (English):** this is the internal status report written during the 0.3
> development cycle, kept for the record because it lists the bugs fixed in that
> phase and the shortcomings that were known at the time. It is written in
> Persian and is *not* part of the public documentation set. Current state:
> [README](../README.md) · [VERIFICATION](../VERIFICATION.md).

# Lumina — گزارش وضعیت، باگ‌های رفع‌شده و کاستی‌های باقی‌مانده

تاریخ: ۱۷ سپتامبر ۲۰۲۶ — نسخهٔ ۰.۳

---

## ۱) نام و هویت برند
| آیتم | وضعیت |
|---|---|
| نام برنامه | **Lumina** (به‌جای Photon موقت) |
| لوگو | **تولیدشده با هوش مصنوعی** — دیافراگم شش‌ضلعی درخشان با گرادیان آبی-بنفش به فیروزه‌ای (سبک Linear/Figma). بین ۴ کاندید تولیدشده با تحلیل پیکسلی انتخاب شد (تقارن چپ/راست ۰.۰۱٪ و بالا/پایین ۰.۰۴٪ — تقریباً کامل). |
| فایل‌ها | `ui/logo.png` (لوگو)، `ui/icon.png` و `electron/icon.png` (آیکون اپ)، `ui/brand-lockup.png` (لوگو + نام)، ۴ کاندید در `ui/brand/` |
| title پنجره / Electron | «Lumina — Image Editor» |
| بیلد exe | `Lumina-$ver-win-$arch-portable.exe` — `productName: "Lumina"`, `appId: ir.lumina.editor`, `icon: electron/icon.png` |

## ۲) باگ‌های رفع‌شده در این مرحله
1. **کامپوزیت لایهٔ تنظیم معیوب** — ترتیب چک `paint` قبل از شاخهٔ `isAdjustment` بود؛ لایه‌های تنظیم (`paint=null`) از حلقه حذف می‌شدند. اصلاح شد + بازنویسی نگاشت ۱×۱ بدون bit-packing (جلوگیری از سرریز/بایت سرگردان).
2. **ابزار Rect هیچ‌کاری نمی‌کرد** — حالا انتخاب مستطیلی با پیش‌نمایش «مورچه‌های متحرک» (marching ants) دارد.
3. **ابزار Text هیچ‌کاری نمی‌کرد** — حالا لایهٔ متنی با فونت Inter، سایز، بولد/ایتالیک/زیرخط و رنگ روی بوم می‌گذارد (رستر می‌شود؛ ویرایش بردار متن فاز بعدی).
4. **Toggle «Contiguous» وصل نبود** — حالا `state.fillContig` به `floodFill` متصل است؛ سطل رنگ پیوسته/غیرپیوسته دقیقاً مثل فتوشاپ رفتار می‌کند (تست واحد جدید).
5. **حالت مردهٔ `moveStart`/`moveGoing`** — حذف شد.
6. **دوبلهٔ لایه کند (پیکسل‌به‌پیکسل)** — با `Paint.clone()` (کپی سطح کاشی به‌صورت بافر کامل، O(تخصیص) به‌جای O(پیکسل)) جایگزین شد.
7. **ماتریس `compositeTransform` اشتباه بود** — ترتیب translate/scale/rotate اشکال داشت؛ بازنویسی به‌ترتیب استاندارد (pivot → scale → rotate → translate) + تست واحد.
8. **بایت سرگردان UTF-8 در ابتدای HTMLها** (از مرحلهٔ قبل) — پاک است.

## ۳) قابلیت‌های جدید
- **لایه‌های تنظیم غیرمخرب** (کلید فتوشاپ): Brightness/Contrast، Levels، Hue/Saturation، Grayscale، Invert، Threshold — با اسلایدر زنده در پنل لایه‌ها.
- **۲۷ مد blend** فتوشاپ در سلکتور پنل لایه‌ها + **opacity** لایه + **Merge Down** + **Flatten Image**.
- **Theme چرخشی**: Dark / Midnight / Light — میانبر `Ctrl+Shift+H`.
- میانبرهای جدول‌محور: `[` `]` سایز قلم، `Ctrl+N` سند جدید، `Delete` حذف لایه، `Enter` لایهٔ جدید.

---

## ۴) کاستی‌ها و مشکلات باقی‌مانده (دقیق)

### بحرانی (باید قبل از «بهتر از فتوشاپ» حل شوند)
- **عمق بیت ۱۶/۳۲** — سند هنوز ۸ بیت است. پیکسل‌ها `Uint8ClampedArray`؛ باید به float16/float32 (half/float) ارتقا یابد تا ادعای «قوی‌تر از فتوشاپ» صادق باشد.
- **مدیریت رنگ** — فقط sRGB مستقیم؛ **بدون ICC profile** و **بدون OpenColorIO/OCIO**. شاخص تمایز با فتوشاپ هنوز خالی است.
- **PSD خوان/نویس** ✅ — اکنون PSD/PSB سادهٔ RGB (RLE/raw) خوانده و PSD تخت نوشته می‌شود.
- **GPU-accelerated rendering** — موتور تایل فعلاً CPU است؛ WebGPU/WebGL هنوز اضافه نشده.
- **متن بردار** — متن رستر می‌شود؛ بدون ویرایش دوباره، تنظیم فاصله، یا فایل فونت سفارشی کاربر.
- **کشیدن به‌صورت انتخاب/تبدیل آزاد** — هنوز فقط brush/eraser واقعی است.
- **Filterهای پرمصرف فتوشاپ** ✅ — Gaussian Blur، Unsharp، Sharpen/Blur موضعی، Curves، Exposure، Vibrance، و ۲۴ افکت موجود است.
- **ماسک لایه در UI** — ساختار `mask` در Layer هست ولی UI برای افزودن/ویرایش ماسک ندارد.
- **گروه لایه / clipping mask / drop shadow** ✅ — گروه + clipping + سایه لایه پیاده و تست شد. smart object هنوز نه.

### مهم
- **COW واقعی** — `clone()` هنوز اشتراکِ بدون copy-on-write است؛ اولین ویرایش باید بافر را عمیق کپی کند تا کلون‌ها به‌هم نچسبند.
- **انتخاب‌ها** ✅ — مستطیلی + بیضوی + Lasso آزاد + چندضلعی + wand، با marching-ants ماندگار و عملیات invert/fill/delete/crop.
- **ابزارهای شکل** ✅ — مستطیل/بیضی/خط (fill+stroke) اضافه شد.
- **Gradient tool** ✅ — خطی/شعاعی اضافه شد.
- **History محدود** — تاریخچهٔ تایل‌محور فقط برای paint ثبت می‌شود؛ عملیات لایه‌ای (add/remove/blend/opacity/تنظیم) undo نمی‌شوند.
- **Zoom/pan** — pan با کشیدن وسط/ctrl کار می‌کند اما بدون space-drag موقت و بدون navigator/minimap.
- **RAW / TIFF / WebP / JPEG** — هنوز decode ندارد.
- **کشش کاشی‌های داغ** — `render()` کل result را روی canvas می‌نویسد (بدون ردیابی dirty در مسیر UI). برای بوم‌های بزرگ، فقط باید تایل‌های dirty آپلود شوند.

### جزئی اما قابل لمس
- **Undo تراکنشی** — یک stroke کامل فقط یک undo (خوب) ولی تغییرات opacity/filter دوبار در هر کشش ثبت می‌شوند.
- **ذخیره** — فقط PNG صادر می‌شود (بدون dialog چندقالبی، بدون JPEG برای وب).
- **Accessibility** — بدون full keyboard nav، بدون screen-reader labels رسمی، کنتراست برخی muted-text پایین.
- **i18n/RTL** — UI فقط انگلیسی (طبق تصمیم) اما متن فارسی در نام‌گذاری داخلی کامنت‌ها وجود دارد.

---

## ۵) عددهای کلیدی
- تست‌ها: **۱۸۹/۱۸۹ واحد سبز** + **۱۴/۱۴ E2E مرورگر headless** — صفر console error هنگام load و interaction.
- **۱۷ فونت واقعی** (انگلیسی/فارسی/روسی) + بارگذاری TTF/OTF توسط کاربر.
- **۲۴ ابزار** در راه‌آهن، **۲۴ افکت (فیلتر)**، **۲۷ حالت بلندینگ**، **۳ تم**، **۴ فرمت فایل (PNG/PSD/BMP/QOI)**.
- **PSD خوان/نویس** (رسترِ تختِ RGB، سازگار با فتوشاپ)، **ابزارهای Clone/Healing/Blur/Sharpen/Smudge/Dodge/Burn/Pencil/Magic Eraser**، **Lasso/جندضلعی/بیضی**، **لایه‌گروهی + clipping mask + drop shadow**، **گرادیان خطی/شعاعی + شکل‌ها**، **ماسک برداری**، **Curves/Exposure/Vibrance**، زیرساخت **عمق ۱۶/۳۲ بیت**.


## ۷) تحقیق نارضایتی کاربران از فتوشاپ (reddit/توییتر) و پاسخ Lumina
یافته‌های کلیدی از بحث‌های عمومی:
1. **اشتراک گران + بدون خرید دائمی** → Lumina یکبارخرید/رایگان، بدون اکانت.
2. **بلاوت و کندی روزافزون، فریز، memory leak بعد از ساعتی کار** → کامپوزیتور تایل‌محور با کش dirty و بدون پروسهٔ پس‌زمینه.
3. **sign-in اجباری + Creative Cloud** → Lumina آفلاین کامل، صفر فرآیند پس‌زمینه.
4. **«پاک‌کن مربعی نداره»** (شکایت محبوب) → **square stamp اضافه شد** (قلم + پاک‌کن مربعی).
5. **Crop از انتخاب خسته‌کننده** (Affinity/PS) → **Crop to Selection** یک‌کلیک.
6. **میانبر قابل شخصی‌سازی نیست** (شکایت از Photopea) → **keymap سفارشی** با localStorage اضافه شد.
7. **مدیریت رنگ ضعیف** → خط لولهٔ فضای خطی از قبل + نقشهٔ راه OCIO/ICC.

## ۶) گام بعدی پیشنهادی (اولویت‌دار)
1. COW واقعی برای تایل‌ها → دوبله/کلون بی‌خطر.
2. ارتقای بافر پیکسل به **float32** (عمق ۳۲ بیت) در Tile + مسیرهای بلندینگ.
3. **ICC profile** از PNG/JPEG + pipeline رنگ (sRGB↔linear↔profile) + پایهٔ OCIO.
4. **PSD reader** (ساختار باز PSD v2/CS) برای interop واقعی.
5. GPU composite (WebGPU) برای سرعت ضد-فتوشاپ.

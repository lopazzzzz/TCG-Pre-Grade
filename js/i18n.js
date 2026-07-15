const STORAGE_KEY = 'cardify-lang';

export const translations = {
  th: {
    step1_title: 'ข้อมูลการ์ด',
    game_pokemon: 'Pokemon TCG',
    game_onepiece: 'One Piece TCG',
    placeholder_card_name: 'ชื่อการ์ด (ไม่บังคับ)',
    placeholder_set_name: 'ชุด/Set (ไม่บังคับ)',
    placeholder_card_number: 'เลขการ์ด (ไม่บังคับ)',

    step2_title: 'อัปโหลดรูปหน้า และ หลัง',
    step2_hint: 'ถ่ายรูปการ์ดให้เต็มเฟรม ไม่ต้องมีพื้นหลังเยอะ เพื่อความแม่นยำของการวัด Centering',
    tip1: 'ใช้แสงสว่างที่มากพอ เห็นรายละเอียดการ์ดชัดเจน',
    tip2: 'ถอดออกจาก Penny Sleeve หรือซองใดๆ ก่อนถ่าย ให้เป็น Raw Card',
    tip3: 'หลีกเลี่ยงแสงสะท้อน/แสงจ้าบนหน้าการ์ด เพราะจะทำให้ผลวิเคราะห์คลาดเคลื่อน',
    example_front_caption: 'ตัวอย่างรูปหน้า — เต็มเฟรม พื้นหลังน้อย',
    example_back_caption: 'ตัวอย่างรูปหลัง — เต็มเฟรม พื้นหลังน้อย',
    front_photo: 'รูปหน้าการ์ด',
    back_photo: 'รูปหลังการ์ด',

    step3_title: 'จัดตำแหน่งมุมการ์ด',
    step3_hint: 'ลากจุดทั้ง 4 ให้ตรงกับมุมจริงของการ์ดในรูป (ใช้กับรูปที่ถ่ายเอียง/ไม่ตรงมุมได้) ระบบจะปรับภาพให้ตรงก่อนวัด Centering',
    front: 'หน้า',
    back: 'หลัง',
    reset_corners: 'รีเซ็ตมุม',
    confirm_alignment: 'ยืนยันการจัดตำแหน่ง',

    step4_title: 'วัด Centering',
    step4_hint: 'เส้นสีเหลืองคือขอบในที่ตรวจจับอัตโนมัติ — ลากปรับได้ถ้าไม่ตรง',
    redetect: 'ตรวจจับใหม่',

    step5_title: 'เครื่องมือปรับแสง / X-ray',
    step5_hint: 'ปรับแสงเพื่อตรวจสอบ Surface ด้วยตาตัวเอง — ลากตรงกลางภาพเพื่อเทียบมุมมองปกติ vs. enhanced',
    brightness: 'ความสว่าง',
    contrast: 'คอนทราสต์',
    exposure: 'Exposure',

    step6_title: 'วิเคราะห์ด้วย AI',
    notice_title: '⚠️ อ่านก่อนกด Analyze',
    notice_body: 'เครื่องมือนี้ให้ผลประเมินเบื้องต้นเท่านั้น เพื่อใช้เป็นแนวทางก่อนส่งการ์ดไปเกรดกับบริษัทเกรดดิ้งจริง AI ถูกฝึกด้วยหลักเกณฑ์การให้คะแนนที่อ้างอิงจากมาตรฐานของ PSA, CGC, BGS และ TAG แต่ผลลัพธ์ไม่รับประกันว่าจะตรงกับเกรดจริงที่ได้รับ กรุณาใช้วิจารณญาณของคุณเอง ทางเราไม่รับผิดชอบต่อความเสียหายใดๆ ที่เกิดจากการตัดสินใจโดยอ้างอิงผลจากเครื่องมือนี้',
    analyze_btn: 'วิเคราะห์ด้วย AI',
    analyzing: 'กำลังวิเคราะห์… อาจใช้เวลาถึง ~20 วินาที',
    upload_both_error: 'กรุณาอัปโหลดรูปหน้าและหลังก่อน',
    save_image_btn: '💾 บันทึกเป็นรูปภาพ',
    saving_image: 'กำลังสร้างภาพ…',
    saved_image: 'บันทึกภาพแล้ว ✓',

    centering: 'Centering',
    corners: 'Corners',
    surface: 'Surface',
    edges: 'Edges',
    company_grade_title: 'เกรดที่ประเมินได้ในแต่ละบริษัท',
    report_title: 'รายงานผลการ Pre-Grade',
    corner_tl: 'บนซ้าย', corner_tr: 'บนขวา', corner_bl: 'ล่างซ้าย', corner_br: 'ล่างขวา',
    confidence_suffix: 'ความมั่นใจ',
    flaws_detected: (n) => `จุดที่พบตำหนิ (${n})`,
    generated_by: (ts) => `สร้างโดย Cardify · ${ts}`,
    flaws_noted: (n) => `จุดที่พบตำหนิ (${n})`,
    approx_area: 'วงกลม = ตำแหน่งโดยประมาณเท่านั้น',
    disclaimer: 'ผลประเมินจาก AI สำหรับการอ้างอิงส่วนตัวเท่านั้น — ไม่มีส่วนเกี่ยวข้องกับ PSA, CGC, BGS หรือ TAG และไม่รับประกันผลลัพธ์การส่งเกรดจริง การตรวจสอบด้วยมือจริงอาจพบตำหนิที่ภาพถ่ายมองไม่เห็น',

    donate_title: '☕ สนับสนุนผู้พัฒนา',
    donate_hint: 'ถ้าเครื่องมือนี้มีประโยชน์กับคุณ และอยากร่วมสนับสนุนค่าใช้จ่ายในการพัฒนาและดูแลต่อ สามารถส่งกำลังใจผ่านช่องทางด้านล่างได้เลยครับ ขอบคุณที่แวะมาใช้งานนะครับ 🙏',
    bank: 'ธนาคาร',
    account_name: 'ชื่อบัญชี',
    account_number: 'เลขที่บัญชี',
    copy: 'คัดลอก',
    copied: 'คัดลอกแล้ว!',
  },
  en: {
    step1_title: 'Card details',
    game_pokemon: 'Pokemon TCG',
    game_onepiece: 'One Piece TCG',
    placeholder_card_name: 'Card name (optional)',
    placeholder_set_name: 'Set (optional)',
    placeholder_card_number: 'Card # (optional)',

    step2_title: 'Upload front & back photos',
    step2_hint: 'Photograph the card frame-filling with minimal background, for accurate Centering measurement.',
    tip1: 'Use enough lighting to clearly show card details',
    tip2: 'Remove any penny sleeve or protector — use a raw card',
    tip3: 'Avoid glare/reflections on the card surface, as they can skew the analysis',
    example_front_caption: 'Front example — frame-filling, minimal background',
    example_back_caption: 'Back example — frame-filling, minimal background',
    front_photo: 'Front photo',
    back_photo: 'Back photo',

    step3_title: 'Align card corners',
    step3_hint: "Drag the 4 points to match the card's actual corners in the photo (works for skewed/angled shots too) — the image will be straightened before measuring Centering.",
    front: 'Front',
    back: 'Back',
    reset_corners: 'Reset corners',
    confirm_alignment: 'Confirm alignment',

    step4_title: 'Centering measurement',
    step4_hint: 'Yellow lines are the auto-detected inner border — drag to correct if needed.',
    redetect: 'Re-detect',

    step5_title: 'Light / X-ray inspection tool',
    step5_hint: 'Adjust lighting to inspect Surface yourself — drag the middle of the image to compare the normal vs. enhanced view.',
    brightness: 'Brightness',
    contrast: 'Contrast',
    exposure: 'Exposure',

    step6_title: 'AI analysis',
    notice_title: '⚠️ Please read before analyzing',
    notice_body: 'This tool provides a preliminary estimate only, meant as a guideline before submitting your card to an official grading company. The AI is trained on scoring logic modeled after the standards published by PSA, CGC, BGS, and TAG, but its results are not guaranteed to match your actual submission grade. Please use this tool at your own discretion — we accept no liability for any loss or damage arising from decisions made based on it.',
    analyze_btn: 'Analyze with AI',
    analyzing: 'Analyzing… this can take up to ~20s',
    upload_both_error: 'Please upload both front and back photos first',
    save_image_btn: '💾 Save as Image',
    saving_image: 'Generating image…',
    saved_image: 'Image saved ✓',

    centering: 'Centering',
    corners: 'Corners',
    surface: 'Surface',
    edges: 'Edges',
    company_grade_title: 'Estimated grade by company',
    flaws_noted: (n) => `Flaws noted (${n})`,
    approx_area: 'circle = approximate area only',
    report_title: 'PRE-GRADE REPORT',
    corner_tl: 'TOP LEFT', corner_tr: 'TOP RIGHT', corner_bl: 'BOTTOM LEFT', corner_br: 'BOTTOM RIGHT',
    confidence_suffix: 'confidence',
    flaws_detected: (n) => `FLAWS DETECTED (${n})`,
    generated_by: (ts) => `Generated by Cardify · ${ts}`,
    disclaimer: 'AI pre-grade estimate for personal reference only — not affiliated with PSA, CGC, BGS, or TAG, and not a guarantee of actual submission results. Physical handling can reveal flaws a photo cannot.',

    donate_title: '☕ Support the developer',
    donate_hint: "If this tool has been useful to you and you'd like to help cover development and maintenance costs, you can send support through the channel below. Thanks for using it! 🙏",
    bank: 'Bank',
    account_name: 'Account name',
    account_number: 'Account number',
    copy: 'Copy',
    copied: 'Copied!',
  },
};

function currentLang() {
  return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'th';
}

export function t(key) {
  const dict = translations[currentLang()];
  return dict[key] !== undefined ? dict[key] : translations.th[key];
}

function applyLang(lang) {
  document.documentElement.setAttribute('lang', lang);
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const value = t(el.dataset.i18n);
    if (typeof value === 'string') el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = lang === 'th' ? 'EN' : 'TH';
}

export function initLangToggle() {
  applyLang(currentLang());
  const btn = document.getElementById('lang-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = currentLang() === 'th' ? 'en' : 'th';
    localStorage.setItem(STORAGE_KEY, next);
    applyLang(next);
    document.dispatchEvent(new CustomEvent('cardify:langchange'));
  });
}

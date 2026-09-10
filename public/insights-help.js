(() => {
  const topics = {
    documentSales: {
      title: 'ยอดขายตามเอกสาร', tag: 'รายงาน 4007',
      intro: 'รวมยอดเงินระดับเอกสารขายในช่วงวันที่เลือก กราฟแนวโน้มยอดขายรายวันใช้ยอดชุดนี้เช่นกัน',
      formula: 'ยอดขายตามเอกสาร = ผลรวมยอดเงินของเอกสารขาย',
      notes: [['ต่างจากยอดรายการสินค้าอย่างไร', 'ยอดเอกสารรวมจากยอดเงินของแต่ละบิล ส่วนยอดรายการสินค้ารวมจากยอดเงินในแต่ละบรรทัดสินค้า เป็นข้อมูลคนละระดับ จึงไม่จำเป็นต้องเท่ากัน'], ['ส่วนต่างเกิดจากอะไร', 'อาจเกี่ยวกับ VAT ส่วนลด การปรับยอดระดับเอกสาร หรือขอบเขตข้อมูลที่สองรายงานใช้ เช่น เงื่อนไขเวลาและรหัสสินค้า ต้องตรวจเอกสารและรายการจริงเพื่อระบุสาเหตุ ไม่ควรถือว่าส่วนต่างทั้งหมดเป็น VAT'], ['ทั้งสองการ์ดยังไม่ใช่ยอดสุทธิหลังรับคืน', 'สองยอดนี้ยังไม่หักเอกสารรับคืน / ลดหนี้ จึงต่างจากยอดซื้อสุทธิรวมในหน้าวิเคราะห์ลูกค้า']],
      snapshot: '#total-sales', compareSales: true
    },
    itemSales: {
      title: 'ยอดขายตามรายการสินค้า', tag: 'รายงาน 4014',
      intro: 'รวมยอดเงินของรายการขายที่มีรหัสสินค้าในช่วงวันที่เลือก ใช้ข้อมูลระดับบรรทัดสินค้า ไม่ใช่ยอดรวมที่หัวเอกสาร',
      formula: 'ยอดขายตามรายการสินค้า = ผลรวมยอดเงินแต่ละรายการขาย',
      notes: [['ทำไมสองการ์ดอาจมีค่าเท่ากัน', 'ถ้ายอดรวมรายการตรงกับยอดเอกสาร และขอบเขตข้อมูลตรงกัน สองยอดจะเท่ากันได้ ปัจจุบันแต่ละการ์ดใช้ข้อมูลคนละชุดแล้ว'], ['อ่านส่วนต่างอย่างไร', 'ส่วนต่าง = ยอดเอกสาร − ยอดรายการสินค้า ค่าบวกแปลว่ายอดเอกสารมากกว่า ค่าลบแปลว่ายอดรายการมากกว่า และศูนย์แปลว่ายอดตรงกัน'], ['ยังไม่ใช่ยอดขายสินค้าสุทธิ', 'การ์ดนี้รวมรายการขายโดยยังไม่หักรับคืน ส่วนยอดขายสินค้าสุทธิในหน้าวิเคราะห์สินค้ารวมเพิ่มหนี้และหักรับคืน รวมทั้งมีตัวกรองสินค้าและหมวดหมู่']],
      snapshot: '#item-sales', compareSales: true
    },
    net: {
      title: 'ยอดซื้อสุทธิรวม', tag: 'ภาพรวมลูกค้า',
      intro: 'ยอดซื้อที่เหลือหลังรวมเอกสารขาย เพิ่มหนี้ และหักเอกสารรับคืน / ลดหนี้ของลูกค้าในช่วงที่เลือก',
      formula: 'ยอดขาย + เพิ่มหนี้ − รับคืน / ลดหนี้',
      notes: [['ยอดบวกกับยอดหักต่างกันอย่างไร', 'ระบบคำนวณยอดสุทธิของลูกค้าแต่ละรายก่อน แล้วจึงแยกกลุ่มที่มียอดบวกและยอดติดลบ ยอดหักในกราฟจึงเป็นยอดสุทธิติดลบของกลุ่มลูกค้า ไม่ใช่ยอดรับคืนทั้งหมด'], ['เปอร์เซ็นต์ในวงแหวน', 'ยอดสุทธิรวม ÷ ยอดรวมของลูกค้าที่มียอดสุทธิบวก × 100 หากไม่มียอดบวกหรือยอดสุทธิรวมติดลบ จะไม่แสดงสัดส่วนนี้'], ['ทำไมไม่เท่ากับยอดขายสินค้าสุทธิ', 'หน้านี้รวมยอดระดับเอกสาร ส่วนมุมมองสินค้ารวมยอดรายการสินค้า จึงอาจต่างกันจาก VAT ส่วนลด และขอบเขตตัวกรอง ต้องใช้ช่วงวันที่และกลุ่มข้อมูลที่สอดคล้องกันก่อนเปรียบเทียบ']],
      snapshot: '#total-net', breakdown: '#net-summary-chart .summary-chart-label'
    },
    customers: {
      title: 'ลูกค้าที่มีรายการ', tag: 'ฐานลูกค้า', intro: 'นับลูกค้าที่มีเอกสารขาย เพิ่มหนี้ หรือรับคืน / ลดหนี้ในช่วงที่เลือก โดยใช้คำค้นหาปัจจุบันด้วย',
      formula: 'ลูกค้ามี 2 บิลขึ้นไป + มี 1 บิล + ไม่มีบิลขาย',
      notes: [['ทำไมมีลูกค้าที่ไม่มีบิลขาย', 'ลูกค้าบางรายมีเฉพาะเอกสารเพิ่มหนี้หรือรับคืน / ลดหนี้ จึงอยู่ในยอดลูกค้าที่มีรายการ แต่จำนวนบิลขายเป็นศูนย์'], ['วงแหวนแสดงอะไร', 'จำนวนลูกค้าที่มีบิลขายตั้งแต่ 2 บิลขึ้นไป ÷ ลูกค้าที่มีรายการทั้งหมดตามตัวกรอง × 100']],
      snapshot: '#customer-count', breakdown: '#count-summary-chart .summary-chart-label'
    },
    invoices: {
      title: 'จำนวนบิลขาย', tag: 'ความถี่การซื้อ', intro: 'รวมจำนวนเอกสารขายของลูกค้าทั้งหมดที่ตรงกับช่วงวันที่และคำค้นหา ไม่นับเอกสารเพิ่มหนี้และรับคืน / ลดหนี้เป็นบิลขาย',
      formula: 'บิลจากลูกค้า 5 อันดับแรก + บิลจากลูกค้าที่เหลือ',
      notes: [['5 อันดับในกราฟนี้จัดอย่างไร', 'เรียงลูกค้าตามจำนวนบิลขายจากมากไปน้อย จึงอาจเป็นคนละกลุ่มกับ 10 ลูกค้าที่มียอดซื้อสูงสุด'], ['เปอร์เซ็นต์คำนวณอย่างไร', 'จำนวนบิลของลูกค้า 5 อันดับแรก ÷ จำนวนบิลขายทั้งหมดตามตัวกรอง × 100']],
      snapshot: '#invoice-count', breakdown: '#invoice-summary-chart .summary-chart-label'
    },
    top: {
      title: '10 ลูกค้าที่มียอดซื้อสูงสุด', tag: 'อันดับลูกค้า', intro: 'เลือกไม่เกิน 10 ลูกค้าที่มียอดซื้อสุทธิสูงสุดจากข้อมูลที่ผ่านตัวกรอง', formula: 'เรียงยอดซื้อสุทธิจากมากไปน้อย → แสดง 10 อันดับ',
      notes: [['ทำไมยอดในกราฟไม่เท่ากับยอดรวม', 'กราฟแสดงเพียง 10 อันดับ แต่การ์ดยอดรวมคิดจากลูกค้าทั้งหมดตามตัวกรอง'], ['เปิดรายละเอียดได้อย่างไร', 'คลิกแท่งกราฟเพื่อดูรายการสินค้าของลูกค้าแต่ละราย']]
    },
    ranking: {
      title: 'ยอดซื้อรายลูกค้า', tag: 'ตารางลูกค้า', intro: 'แสดงลูกค้าทุกคนที่ตรงกับคำค้นหาและช่วงวันที่ เรียงตามยอดซื้อสุทธิจากมากไปน้อย', formula: 'ยอดสุทธิรายลูกค้า = ขาย + เพิ่มหนี้ − รับคืน / ลดหนี้',
      notes: [['ตัวเลขมุมขวาบนหมายถึงอะไร', 'จำนวนลูกค้าที่พบทั้งหมด ไม่ใช่จำนวนแถวในหน้าตารางปัจจุบัน ตารางแบ่งหน้าครั้งละ 10 ราย'], ['ยอดติดลบหมายถึงอะไร', 'ในช่วงที่เลือก ลูกค้ารายนั้นมียอดรับคืน / ลดหนี้มากกว่ายอดขายและเพิ่มหนี้ ไม่ได้แปลว่าเป็นยอดค้างชำระ']], snapshot: '#matching-count'
    },
    productNet: {
      title: 'ยอดขายสินค้าสุทธิ', tag: 'ภาพรวมสินค้า', intro: 'รวมยอดสุทธิระดับรายการสินค้าที่ตรงกับคำค้นหาและหมวดหมู่ แล้วเทียบกับช่วงก่อนหน้าที่มีจำนวนวันเท่ากัน', formula: '(ยอดช่วงนี้ − ยอดช่วงก่อน) ÷ ยอดช่วงก่อน × 100',
      notes: [['ต่างจากยอดซื้อสุทธิรวมอย่างไร', 'ยอดซื้อของลูกค้าใช้ยอดระดับเอกสาร ส่วนยอดสินค้านี้ใช้ยอดระดับรายการ จึงอาจต่างกันจาก VAT ส่วนลด และตัวกรองลูกค้าหรือสินค้า'], ['เลือกช่วงเปรียบเทียบอย่างไร', 'ใช้ช่วงที่อยู่ก่อนวันเริ่มต้นทันที โดยมีจำนวนวันเท่ากับช่วงที่เลือก'], ['เมื่อไม่มีฐานเปรียบเทียบ', 'ถ้ายอดช่วงก่อนเป็นศูนย์หรือติดลบ จะแสดงว่าไม่มีฐานบวกให้เทียบแทนเปอร์เซ็นต์']], snapshot: '#performance-net', breakdown: '.performance-comparison-value'
    },
    sold: {
      title: 'สินค้าที่มีบิลขาย', tag: 'ความครอบคลุมการขาย', intro: 'นับรหัสสินค้าที่มีบิลขายอย่างน้อย 1 บิลในช่วงที่เลือก ตามคำค้นหาและหมวดหมู่ปัจจุบัน', formula: 'รหัสสินค้าที่มีบิลขาย ÷ รหัสสินค้าทั้งหมดตามตัวกรอง × 100',
      notes: [['มีบิลขายไม่ได้แปลว่ายอดสุทธิเป็นบวก', 'สินค้าที่มีรับคืน / ลดหนี้อาจมียอดสุทธิเป็นศูนย์หรือติดลบ แต่ยังนับว่ามีบิลขาย'], ['ดูรายการสินค้า', 'กดพื้นที่การ์ดเพื่อกรองรายการสินค้าที่มีบิลขาย ปุ่มคำอธิบายนี้ใช้เปิดรายละเอียดของตัวเลขเท่านั้น']], snapshot: '#performance-sold'
    },
    unsold: {
      title: 'ยังไม่มีบิลขาย', tag: 'สินค้าที่ยังไม่เคลื่อนไหว', intro: 'นับสินค้าที่อยู่ในทะเบียนและไม่มีบิลขายในช่วงวันที่เลือก ตามคำค้นหาและหมวดหมู่', formula: 'สินค้าในทะเบียนที่ไม่มีบิลขาย ÷ สินค้าในทะเบียนตามตัวกรอง × 100',
      notes: [['ไม่ได้หมายถึงไม่เคยขาย', 'สินค้าอาจขายนอกช่วงวันที่เลือก หรือมีเฉพาะเอกสารประเภทอื่นในช่วงนี้'], ['ทำไมเปอร์เซ็นต์ไม่รวมกับสินค้ามีบิลเป็น 100%', 'สองการ์ดใช้ฐานอ้างอิงต่างกัน การ์ดนี้ใช้เฉพาะสินค้าในทะเบียน ส่วนสินค้าที่มีบิลใช้สินค้าทั้งหมดตามตัวกรอง ซึ่งอาจรวมรหัสที่ไม่อยู่ในทะเบียน']], snapshot: '#performance-unsold'
    },
    declining: {
      title: 'ยอดขายลดลง', tag: 'เปรียบเทียบช่วงเวลา', intro: 'นับสินค้าที่ช่วงก่อนมียอดสุทธิเป็นบวก และช่วงนี้มียอดสุทธิน้อยกว่าช่วงก่อน', formula: 'สินค้ายอดลดลง ÷ สินค้าที่ช่วงก่อนมียอดสุทธิเป็นบวก × 100',
      notes: [['เปอร์เซ็นต์บนวงแหวนคืออะไร', 'เป็นสัดส่วนจำนวนรหัสสินค้าที่ยอดลดลง ไม่ใช่เปอร์เซ็นต์มูลค่ายอดขายที่ลดลง'], ['ช่วงเวลาที่ใช้เทียบ', 'ใช้ช่วงก่อนหน้าที่ติดกันและมีจำนวนวันเท่ากัน เพื่อให้เปรียบเทียบได้บนระยะเวลาเดียวกัน']], snapshot: '#performance-declining'
    },
    best: {
      title: 'สินค้าที่ทำยอดสูงสุด', tag: '5 อันดับสินค้า', intro: 'แสดงไม่เกิน 5 สินค้าที่มีบิลขายและมียอดสุทธิเป็นบวก เรียงตามยอดสุทธิจากมากไปน้อย', formula: 'สินค้ามีบิลขาย + ยอดสุทธิเป็นบวก → เรียง 5 อันดับ',
      notes: [['อันดับเปลี่ยนตามอะไร', 'ช่วงวันที่ คำค้นหาสินค้า และหมวดหมู่ที่เลือก'], ['ยอดขายกับจำนวนขาย', 'อันดับนี้อิงมูลค่าสุทธิ ไม่ใช่จำนวนชิ้น คลิกสินค้าเพื่อดูจำนวนขายแยกหน่วยและลูกค้าที่ซื้อ']]
    },
    watch: {
      title: 'ยอดขายลดลงที่ควรติดตาม', tag: 'ติดตามสินค้า', intro: 'แสดงไม่เกิน 5 สินค้าที่มูลค่ายอดสุทธิลดลงมากที่สุด เมื่อเทียบกับช่วงก่อนหน้าที่มีจำนวนวันเท่ากัน', formula: 'มูลค่าที่ลดลง = ยอดช่วงก่อน − ยอดช่วงนี้',
      notes: [['จัดอันดับด้วยมูลค่า', 'เรียงส่วนต่างเป็นบาทจากมากไปน้อย ไม่ได้เรียงตามเปอร์เซ็นต์ที่ลดลง'], ['สินค้าใดเข้ากลุ่มนี้', 'เฉพาะสินค้าที่ช่วงก่อนมียอดสุทธิเป็นบวกและช่วงนี้ยอดน้อยลง คลิกสินค้าเพื่อดูรายละเอียดก่อนสรุปสาเหตุ']]
    }
  };
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const dialog = make('dialog', '', 'insight-help-dialog');
  dialog.id = 'insight-help-dialog';
  dialog.setAttribute('aria-labelledby', 'insight-help-title');
  dialog.setAttribute('aria-describedby', 'insight-help-intro');
  document.body.append(dialog);
  let opener;
  const close = () => dialog.close();
  dialog.addEventListener('close', () => { document.body.classList.remove('insight-help-open'); opener?.focus(); });
  let outside = false;
  const isOutside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', event => { outside = isOutside(event); });
  dialog.addEventListener('click', event => { if (outside && isOutside(event)) close(); outside = false; });
  function show(key, button) {
    const topic = topics[key];
    opener = button;
    dialog.replaceChildren();
    const header = make('header', '', 'insight-help-header');
    const heading = make('div');
    heading.append(make('span', topic.tag, 'insight-help-tag'));
    const title = make('h2', topic.title); title.id = 'insight-help-title'; heading.append(title);
    const dismiss = make('button', '×', 'insight-help-close'); dismiss.type = 'button'; dismiss.autofocus = true; dismiss.setAttribute('aria-label', 'ปิดคำอธิบาย'); dismiss.addEventListener('click', close);
    header.append(heading, dismiss);
    const body = make('div', '', 'insight-help-body');
    const intro = make('p', topic.intro, 'insight-help-intro'); intro.id = 'insight-help-intro'; body.append(intro);
    const current = topic.snapshot && document.querySelector(topic.snapshot)?.textContent.trim();
    if (current && current !== '—') {
      const value = make('div', '', 'insight-help-value');
      value.append(make('span', 'ค่าที่แสดงบนการ์ดขณะเปิด'), make('strong', current)); body.append(value);
    }
    const formula = make('section', '', 'insight-help-formula');
    formula.append(make('span', 'วิธีอ่านตัวเลข'), make('p', topic.formula)); body.append(formula);
    if (topic.compareSales) {
      const documentValue = document.querySelector('#total-sales')?.dataset.amount;
      const itemValue = document.querySelector('#item-sales')?.dataset.amount;
      if (documentValue !== undefined && itemValue !== undefined && Number.isFinite(Number(documentValue)) && Number.isFinite(Number(itemValue))) {
        const format = value => '฿' + new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
        const difference = Number(documentValue) - Number(itemValue);
        const comparison = make('div', '', 'insight-help-breakdown');
        for (const [label, amount] of [['ยอดเอกสาร · 4007', Number(documentValue)], ['ยอดรายการสินค้า · 4014', Number(itemValue)], ['ส่วนต่าง (เอกสาร − รายการ)', difference]]) {
          const row = make('div'); row.append(make('span', label), make('b', format(amount))); comparison.append(row);
        }
        body.append(comparison);
      }
    }
    if (topic.breakdown) {
      const rows = document.querySelectorAll(topic.breakdown);
      if (rows.length) {
        const breakdown = make('div', '', 'insight-help-breakdown');
        rows.forEach(row => { const item = make('div'); item.append(make('span', row.querySelector('span')?.textContent || ''), make('b', row.querySelector('b')?.textContent || '')); breakdown.append(item); });
        body.append(breakdown);
      }
    }
    const notes = make('div', '', 'insight-help-notes');
    topic.notes.forEach(([label, description], index) => {
      const section = make('section'); const copy = make('div');
      copy.append(make('h3', label), make('p', description));
      section.append(make('span', String(index + 1).padStart(2, '0'), 'insight-help-step'), copy); notes.append(section);
    });
    body.append(notes);
    const footer = make('footer', '', 'insight-help-footer');
    footer.append(make('span', 'ตัวเลขอ้างอิงข้อมูลและตัวกรองที่แสดงอยู่'));
    const done = make('button', 'เข้าใจแล้ว', 'insight-help-done'); done.type = 'button'; done.addEventListener('click', close); footer.append(done);
    dialog.append(header, body, footer);
    document.body.classList.add('insight-help-open'); dialog.showModal();
  }
  function wire(target, key, replace = false) {
    if (!target) return;
    const button = make('button', replace ? target.textContent : 'ⓘ', replace ? target.className : 'insight-help-trigger');
    button.type = 'button'; button.dataset.insightHelp = key;
    button.setAttribute('aria-label', `คำอธิบาย ${topics[key].title}`);
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', dialog.id);
    button.title = `คำอธิบาย ${topics[key].title}`;
    if (replace) { if (target.id) button.id = target.id; target.replaceWith(button); }
    else if (target.tagName === 'BUTTON') {
      const wrapper = make('div', '', 'insight-help-card-wrap'); target.replaceWith(wrapper); wrapper.append(target, button);
    } else { target.classList.add('insight-help-card'); target.append(button); }
    button.addEventListener('click', event => { event.stopPropagation(); show(key, button); });
  }
  document.querySelectorAll('#customer-dashboard .summary-icon').forEach((target, index) => wire(target, ['net', 'customers', 'invoices'][index], true));
  wire(document.querySelector('.chart-panel .pill'), 'top', true);
  wire(document.getElementById('matching-count'), 'ranking', true);
  wire(document.getElementById('document-sales-help'), 'documentSales', true);
  wire(document.getElementById('item-sales-help'), 'itemSales', true);
  ['net', 'sold', 'unsold', 'declining'].forEach((key, index) => wire(document.getElementById(`performance-${key}`)?.closest('.summary-card'), ['productNet', 'sold', 'unsold', 'declining'][index]));
  document.querySelectorAll('.performance-highlights .pill').forEach((target, index) => wire(target, ['best', 'watch'][index], true));
})();

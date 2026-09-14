// Decode entities after removing tags so encoded literal < and > remain text.
export function descriptionText(value) {
  const entities = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ensp:' ',emsp:' ',thinsp:' ',ndash:'–',mdash:'—',hellip:'…',bull:'•',middot:'·',times:'×',divide:'÷',deg:'°',copy:'©',reg:'®',trade:'™',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”'};
  return String(value ?? '')
    .replace(/<!--[\s\S]*?-->/g,'')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,(tag,name)=>{
      name=name.toLowerCase();
      if(name==='li')return tag.startsWith('</')?'\n':'\n• ';
      if(/^(br|p|div|article|section|h[1-6]|ul|ol|tr|table|blockquote|hr)$/.test(name))return '\n';
      if(/^(td|th)$/.test(name))return '\t';
      return '';
    })
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(entity,key)=>{
      if(key[0]==='#'){
        const code=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
        return code>0&&code<=0x10ffff?String.fromCodePoint(code):entity;
      }
      return entities[key.toLowerCase()]??entity;
    })
    .replace(/\\r\\n|\\n|\\r/g,'\n').replace(/\u00a0/g,' ')
    .replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n')
    .replace(/\n{3,}/g,'\n\n').trim();
}

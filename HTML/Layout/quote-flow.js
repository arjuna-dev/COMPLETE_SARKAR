/* Pretext 0.0.9 is bundled locally. Masks are generated from the actual artwork. */
(function () {
  'use strict';
  window.layoutQuoteArtwork = function (index, text, title, href) {
    const sheet = document.getElementById('quote-sheet');
    const node = document.getElementById('quote-text');
    const mask = QuoteMasks[index];
    const width = sheet.clientWidth, height = sheet.clientHeight;
    const family = getComputedStyle(sheet).getPropertyValue('--quote-display').trim();
    const sx = width / mask.width, sy = height / mask.height;
    function slots(y, lineHeight) {
      const first = Math.floor(y / sy), last = Math.ceil((y + lineHeight) / sy);
      const runs = [];
      let start = -1;
      for (let x=0; x<=mask.width; x++) {
        let safe = x < mask.width && last < mask.height;
        for (let row=first; safe && row<=last; row++) safe = mask.rows[row][x] === '1';
        if (safe && start<0) start=x;
        if (!safe && start>=0) { runs.push({x:start*sx, width:(x-start)*sx}); start=-1; }
      }
      return runs;
    }
    function compose(size) {
      const leading = size * 1.3;
      const parts = [{text, font: '500 '+size+'px '+family, size, source:false}];
      if (title) parts.push({text:title, font: '400 '+(size*.65)+'px Tahoma', size:size*.65, source:true});
      let y = height * .045, previousX = null;
      const lines=[];
      for (const part of parts) {
        const prepared = Pretext.prepareWithSegments(part.text, part.font);
        let cursor={segmentIndex:0,graphemeIndex:0};
        if(part.source) y+=size*.65;
        while(true) {
          if (!Pretext.layoutNextLine(prepared,cursor,1000000)) break;
          if(y+leading>=height*.96) return null;
          const runs=slots(y,leading).filter(r=>r.width>=size*5);
          runs.sort((a,b)=>(b.width-(previousX===null?0:Math.abs(b.x-previousX)*.3))-(a.width-(previousX===null?0:Math.abs(a.x-previousX)*.3)));
          if(!runs.length) {y+=Math.max(sy,leading*.35);continue;}
          const run=runs[0];
          const line=Pretext.layoutNextLine(prepared,cursor,run.width-2);
          if(!line || line.width>run.width-1) {y+=leading;continue;}
          lines.push({text:line.text,x:run.x+1,y,width:run.width-2,size:part.size,font:part.font,source:part.source});
          cursor=line.end;previousX=run.x;y+=leading;
        }
      }
      return lines;
    }
    // Font sizing is a separate search; Pretext lays out each candidate in safe slots.
    let high=Math.min(46,width*.061), low=high, lines=compose(low);
    while(!lines && low>.1) {high=low;low*=.75;lines=compose(low);}
    if(!lines) throw new Error('No usable light area in quote artwork');
    for(let i=0;i<9;i++) {const mid=(low+high)/2, candidate=compose(mid);if(candidate){low=mid;lines=candidate;}else high=mid;}
    node.replaceChildren();
    node.setAttribute('aria-label',text+(title?' '+title:''));
    const fragment=document.createDocumentFragment();
    for(const line of lines) {
      const span=document.createElement(line.source && href?'a':'span');
      if(line.source && href){span.href=href;span.target='_blank';span.rel='noopener noreferrer';}
      span.className='artwork-line';
      span.textContent=line.text;
      Object.assign(span.style,{left:line.x+'px',top:line.y+'px',font:line.font,lineHeight:(low*1.3)+'px',width:line.width+'px'});
      fragment.appendChild(span);
    }
    node.appendChild(fragment);
    sheet.dataset.fontSize=low.toFixed(2);
    sheet.dataset.layout='pretext';
  };
})();

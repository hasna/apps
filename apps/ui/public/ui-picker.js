var V=(j,q)=>{let z=(j??"").trim();return z.length>0?z:q};function A(){let j=document.querySelector("[data-uidotsh-pick]");if(!j)return null;let q=[],z=0;for(let B of Array.from(j.querySelectorAll("[data-uidotsh-option]"))){if(B.closest("[data-uidotsh-pick]")!==j)continue;z+=1,q.push({label:V(B.getAttribute("data-uidotsh-option"),`Option ${z}`),element:B})}return{label:V(j.getAttribute("data-uidotsh-pick"),"Decision 1"),options:q}}var W=(j)=>Math.max(0,j.options.findIndex((q)=>!q.element.hidden));function X(j,q){let z=q??j.options.find((C)=>!C.element.hidden)??j.options[0];if(!z)return!1;let B=!1;for(let C of j.options){let H=C!==z;if(C.element.hidden!==H)C.element.hidden=H,B=!0;if(H)C.element.style.display="none";else C.element.style.removeProperty("display")}return B}var Q=(j)=>{if(!(j instanceof Element))return!1;if(j.matches("[data-uidotsh-pick]")||j.matches("[data-uidotsh-option]"))return!0;return j.querySelector("[data-uidotsh-pick]")!==null||j.querySelector("[data-uidotsh-option]")!==null},E=`
  :host { display:block; position:fixed; width:0; height:0; overflow:visible;
    color:#fff; font-family:ui-sans-serif, system-ui, sans-serif; line-height:1; }
  *,*::before,*::after { box-sizing:border-box; }
  [data-popover] { display:block; position:fixed; left:50%; bottom:16px;
    transform:translateX(-50%); margin:0; padding:0; border:0; width:auto;
    max-width:calc(100vw - 16px); background:transparent; color:inherit;
    overflow:visible; outline:none; }
  [data-panel] { display:grid; grid-template-columns:auto auto 1fr auto auto;
    align-items:stretch; min-width:16rem; height:40px; border-radius:12px; padding:4px;
    background:rgba(10,10,10,0.8);
    box-shadow:0 0 0 1px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.1), 0 25px 50px -12px rgba(0,0,0,0.5);
    backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); }
  [data-nav] { width:32px; height:32px; border:0; border-radius:8px; display:inline-flex;
    align-items:center; justify-content:center; color:#a3a3a3; background:transparent; cursor:pointer;
    transition:color 120ms ease, background-color 120ms ease, opacity 120ms ease; }
  [data-nav]:hover, [data-nav]:focus-visible { color:#fff; background:rgba(255,255,255,0.1); outline:none; }
  [data-nav]:disabled { opacity:0.45; cursor:default; }
  [data-divider-wrap] { display:flex; align-items:center; padding:0 4px; }
  [data-divider] { width:1px; height:16px; background:rgba(255,255,255,0.12); }
  [data-center] { position:relative; min-width:0; border-radius:8px; display:flex; align-items:center;
    gap:8px; padding:0 8px; color:#fff; cursor:pointer; transition:background-color 120ms ease; }
  [data-center]:hover, [data-center]:focus-within { background:rgba(255,255,255,0.1); }
  [data-meta] { min-width:0; flex:1; display:flex; align-items:baseline; gap:8px; }
  [data-position] { flex-shrink:0; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size:12px; color:rgba(255,255,255,0.5); }
  [data-select] { min-width:0; flex:1; border:0; outline:none; color:#fff; background:transparent;
    appearance:none; font-size:13px; font-weight:500; text-align:center; white-space:nowrap;
    text-overflow:ellipsis; overflow:hidden; padding-right:18px; cursor:pointer; }
  [data-select]:disabled { cursor:default; color:rgba(255,255,255,0.6); }
  [data-chevron] { position:absolute; right:8px; width:14px; height:14px; color:#737373;
    pointer-events:none; transform:rotate(180deg); }
  [data-badge] { position:absolute; left:8px; top:-8px; font-size:9px; letter-spacing:0.04em;
    text-transform:uppercase; color:rgba(255,255,255,0.4); }
  @media (max-width:640px) {
    [data-popover] { left:8px; bottom:8px; transform:none; max-width:calc(100vw - 16px); }
    [data-panel] { min-width:calc(100vw - 16px); }
  }
`,G=`
  <div popover="manual" data-popover aria-label="UI picker (local)" tabindex="-1">
    <section data-panel>
      <button type="button" data-nav data-previous aria-label="Previous option">
        <svg viewBox="0 0 5 6" fill="currentColor" width="5" height="6" aria-hidden="true">
          <path d="M0.75 3L4.25 5.25L4.25 0.75L0.75 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </button>
      <div data-divider-wrap><div data-divider></div></div>
      <div data-center>
        <span data-meta>
          <span data-position>0/0</span>
          <select data-select aria-label="Select option"></select>
        </span>
        <svg viewBox="0 0 16 16" fill="currentColor" data-chevron aria-hidden="true">
          <path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
        </svg>
      </div>
      <div data-divider-wrap><div data-divider></div></div>
      <button type="button" data-nav data-next aria-label="Next option">
        <svg viewBox="0 0 5 6" fill="currentColor" width="5" height="6" aria-hidden="true">
          <path d="M4.25 3L0.75 5.25L0.75 0.75L4.25 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </button>
    </section>
  </div>
`;class $ extends HTMLElement{root;popover;prevBtn;nextBtn;positionText;select;group=null;onSelect=null;constructor(){super();this.root=this.attachShadow({mode:"open"}),this.root.innerHTML=`<style>${E}</style>${G}`,this.popover=this.root.querySelector("[data-popover]"),this.prevBtn=this.root.querySelector("[data-previous]"),this.nextBtn=this.root.querySelector("[data-next]"),this.positionText=this.root.querySelector("[data-position]"),this.select=this.root.querySelector("[data-select]");let j=this.root.querySelector("[data-center]");this.prevBtn.addEventListener("click",()=>this.move(-1)),this.nextBtn.addEventListener("click",()=>this.move(1)),this.select.addEventListener("change",()=>{let q=this.group;if(!q)return;let z=q.options[this.select.selectedIndex];if(z)this.onSelect?.(z)}),j.addEventListener("pointerdown",(q)=>{if(q.button!==0||this.select.disabled)return;if(q.target instanceof Element&&q.target.closest("select"))return;q.preventDefault(),q.stopPropagation(),this.openSelect()}),this.popover.addEventListener("keydown",this.handleKey)}connectedCallback(){this.ensureVisible()}update(j,q){this.group=j,this.onSelect=q,this.render(j),this.ensureVisible()}isOpen(){try{return this.popover.matches(":popover-open")}catch{return this.popover.hasAttribute("data-open")}}ensureVisible(){if(this.isOpen())return;try{this.popover.showPopover?.()}catch{}this.popover.setAttribute("data-open","")}raiseToTop(){if(!this.isOpen()){this.ensureVisible();return}if(this.root.activeElement instanceof HTMLSelectElement)return;try{this.popover.hidePopover?.(),this.popover.showPopover?.()}catch{}}render(j){this.positionText.title=j.label;let q=j.options.length>1;if(this.prevBtn.disabled=!q,this.nextBtn.disabled=!q,this.select.replaceChildren(),j.options.length===0){let B=document.createElement("option");B.textContent="No variations found",this.select.append(B),this.select.disabled=!0,this.positionText.textContent="0/0";return}let z=W(j);this.positionText.textContent=`${z+1}/${j.options.length}`;for(let B of j.options){let C=document.createElement("option");C.textContent=B.label,this.select.append(C)}this.select.disabled=!1,this.select.selectedIndex=z}move(j){let q=this.group;if(!q||q.options.length<=1)return;let z=(W(q)+j+q.options.length)%q.options.length,B=q.options[z];if(B)this.onSelect?.(B),this.popover.focus({preventScroll:!0})}openSelect(){if(this.select.disabled)return;this.select.focus({preventScroll:!0});let j=this.select;if(j.showPicker)try{j.showPicker();return}catch{}this.select.click()}handleKey=(j)=>{if(!this.group||j.metaKey||j.ctrlKey||j.altKey)return;if((j.key==="ArrowDown"||j.key==="ArrowUp")&&!(this.root.activeElement instanceof HTMLSelectElement)){j.preventDefault(),this.openSelect();return}if(j.key==="ArrowLeft"||j.key==="ArrowRight")j.preventDefault(),this.move(j.key==="ArrowRight"?1:-1)}}function Z(j){return j instanceof Element&&j.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')!==null}function _(){let j=window;if(j.__uidotshPickerLoaded)return;if(j.__uidotshPickerLoaded=!0,!customElements.get("uidotsh-picker"))customElements.define("uidotsh-picker",$);let q=null,z=!1,B=()=>{if(!q)return;let D=document.body??document.documentElement;if(!q.isConnected||q.parentElement!==D)D.append(q)},C=()=>{let D=A();if(!D){q?.remove(),q=null;return}if(X(D),!q)q=document.createElement("uidotsh-picker");B(),q.update(D,(J)=>{if(X(D,J))C()})},H=()=>{if(z)return;z=!0,requestAnimationFrame(()=>{z=!1,C()})};new MutationObserver((D)=>{for(let J of D){if(J.type==="attributes"){if(Q(J.target))return H();continue}for(let N of Array.from(J.addedNodes))if(Q(N))return H();for(let N of Array.from(J.removedNodes))if(Q(N))return H()}}).observe(document.documentElement,{subtree:!0,childList:!0,attributes:!0,attributeFilter:["data-uidotsh-pick","data-uidotsh-option","hidden"]}),document.addEventListener("keydown",(D)=>{if(!q)return;if(D.target instanceof Node&&q.contains(D.target))return;if(Z(D.target)||Z(document.activeElement))return;q.handleKey(D)},!0),C()}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_,{once:!0});else _();

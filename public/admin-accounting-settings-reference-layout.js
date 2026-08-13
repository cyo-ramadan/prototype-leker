(() => {
  const style = document.createElement('style');
  style.id = 'accountingReferenceLayoutStyle';
  style.textContent = `
    /* Bos Cyo reference UX: transaction list stays visually separate and Debit/Kredit stay side-by-side, including phone layouts. */
    #tab-accounting-settings-comfort .acc-rules-editor{overflow-x:auto}
    #tab-accounting-settings-comfort .acc-columns{
      grid-template-columns:minmax(180px,1fr) minmax(180px,1fr)!important;
      align-items:start;
    }
    #tab-accounting-settings-comfort .acc-col.debit,
    #tab-accounting-settings-comfort .acc-col.credit{min-width:0}
    #tab-accounting-settings-comfort .acc-col h3{
      font-size:13px;
      font-weight:900;
      margin-bottom:12px;
    }
    @media(max-width:980px){
      #tab-accounting-settings-comfort .acc-item-grid{grid-template-columns:1fr!important}
      #tab-accounting-settings-comfort .acc-columns{
        grid-template-columns:minmax(175px,1fr) minmax(175px,1fr)!important;
      }
    }
    @media(max-width:760px){
      #tab-accounting-settings-comfort{overflow-x:auto}
      #tab-accounting-settings-comfort .acc-comfort-shell{display:block;min-width:0}
      #tab-accounting-settings-comfort .acc-side{min-height:auto}
      #tab-accounting-settings-comfort .acc-nav{grid-template-columns:repeat(2,minmax(0,1fr))}
      #tab-accounting-settings-comfort .acc-boundary{display:none}
      #tab-accounting-settings-comfort .acc-page{padding:14px}
      #tab-accounting-settings-comfort .acc-rules-layout{
        display:grid!important;
        grid-template-columns:132px minmax(390px,1fr)!important;
        min-width:522px;
        margin:0!important;
        overflow:visible;
      }
      #tab-accounting-settings-comfort .acc-tx-list{
        border-right:1px solid #e4e1d8!important;
        min-width:132px;
      }
      #tab-accounting-settings-comfort .acc-tx-head{padding:12px 10px}
      #tab-accounting-settings-comfort .acc-tx{padding:11px 10px}
      #tab-accounting-settings-comfort .acc-rules-editor{
        padding:14px!important;
        min-width:390px;
        overflow:visible;
      }
      #tab-accounting-settings-comfort .acc-columns{
        display:grid!important;
        grid-template-columns:minmax(180px,1fr) minmax(180px,1fr)!important;
        gap:10px;
      }
      #tab-accounting-settings-comfort .acc-col{padding:10px}
      #tab-accounting-settings-comfort .acc-rule{padding:8px}
      #tab-accounting-settings-comfort .acc-rule-top{align-items:flex-start}
      #tab-accounting-settings-comfort .acc-preview{min-width:360px}
    }
  `;
  document.head.appendChild(style);
})();

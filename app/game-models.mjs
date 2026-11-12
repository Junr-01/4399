const efforts = { none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大', ultra: '超强' };

export const effortName = effort => efforts[effort] ?? effort;
export const effortOption = effort => efforts[effort] ? `${efforts[effort]}（${effort}）` : effort;
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function selectModel(models, draft) {
  const model = models.find(item => item.id === draft.model) ?? models.find(item => item.isDefault) ?? models[0];
  if (!model) return;
  draft.model = model.id;
  if (!model.efforts.includes(draft.effort)) draft.effort = model.defaultEffort;
}

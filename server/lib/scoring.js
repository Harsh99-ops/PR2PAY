export function scoreCriteria(criteriaResults) {
  const total = criteriaResults.length;
  const passed = criteriaResults.filter(item => item.status === 'passed').length;
  const score = total === 0 ? 0 : Math.round((passed / total) * 10000) / 100;
  return { passed, total, score, eligible: score >= 60 };
}

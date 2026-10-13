import { apiFetch } from './session';
import { useEffect, useState } from 'react';
import { useTelemetry } from './telemetry';
import './history.css';

type Forecast = { unit: string | null; target: string; prediction: number; input_value: number; selected_model: string; horizon_minutes: number; forecast_time: string; advisory: string; status: string; beats_naive_on_test: boolean; test: Record<string, { mae: number; rmse: number; samples: number }> };
export function ForecastPanel({ active = true }: { active?: boolean }) {
  const telemetry = useTelemetry();
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    apiFetch('/api/forecast', { signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.detail); return data; })
      .then(data => { setData(data); setError(null); }).catch(error => { if (error.name !== 'AbortError') { setError(String(error)); setData(null); } });
    return () => controller.abort();
  }, [active, telemetry.current?.run_id, telemetry.current?.sequence]);
  const selectedTest = data?.test[data.selected_model], naiveTest = data?.test.naive;
  const comparison = !selectedTest || !naiveTest ? '시험 구간의 기준 모델 비교값을 확인할 수 없습니다.' : selectedTest.mae > naiveTest.mae ? '시험 구간에서는 선택 모델의 오차가 Naive보다 큽니다. 현재값을 그대로 유지하는 단순 예측보다 성능이 낮았습니다.' : selectedTest.mae === naiveTest.mae ? '시험 구간에서 선택 모델은 Naive와 같은 오차를 보였습니다. 현재값을 유지하는 단순 예측보다 개선되지 않았습니다.' : '시험 구간에서 선택 모델의 평균 절대 오차가 Naive보다 작았습니다. 앞으로의 정확도나 제어 효과를 보장하지 않습니다.';
  return <section tabIndex={-1} className="analysis panel" aria-label="온도 예측"><div className="panel-heading"><div><span className="eyebrow">TEMPERATURE FORECAST</span><h2>재열기 온도 · 5분 후 관측 예측</h2></div><span className="quiet">관측 추세 참고</span></div><div className="analysis-content">{error && <p role="status" className="note" data-testid="forecast-unavailable">{error}</p>}{data && <><div className="analysis-stats"><span>{data.target} ({data.unit ?? '단위 정의 없음'})<b>{data.input_value.toFixed(2)}</b></span><span>예측값 · {data.unit ?? '단위 정의 없음'}<b data-testid="forecast-value">{data.prediction.toFixed(2)}</b></span><span>선택 모델<b>{data.selected_model}</b></span></div><p className="quiet">예측 시각 {data.forecast_time} · {telemetry.status}</p><p className={`forecast-summary ${data.beats_naive_on_test ? 'positive' : ''}`} data-testid="forecast-comparison">{comparison}</p><details className="forecast-details"><summary>모델별 시험 성능 자세히 보기</summary><table className="responsive-table"><caption>시간순 시험 구간 예측 성능</caption><thead><tr><th scope="col">모델</th><th scope="col">평균 절대 오차 ({data.unit ?? '단위 미확인'})</th><th scope="col">제곱평균제곱근 오차 ({data.unit ?? '단위 미확인'})</th><th scope="col">표본 수</th></tr></thead><tbody>{Object.entries(data.test).map(([name, metric]) => <tr key={name}><td data-label="모델">{name}</td><td data-label="MAE">{metric.mae.toFixed(4)}</td><td data-label="RMSE">{metric.rmse.toFixed(4)}</td><td data-label="Samples">{metric.samples}</td></tr>)}</tbody></table></details><p className="note">{data.advisory}</p></>}</div></section>;
}

import type { BaselineSource, BaselineStatus } from '@fx/contracts';

const time = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));

export function BaselinePanel({
  source,
  status,
}: {
  source: BaselineSource;
  status: BaselineStatus | null;
}) {
  const reference = source.kind === 'reference' ? source.reference : null;
  return (
    <details className="baseline-panel" aria-label="开局数据来源">
      <summary>
        <span>
          <b>开局基准</b> · {reference ? 'Twelve Data 参考汇率' : '2023 历史统计 + 本局扰动'}
        </span>
        <span className={reference?.staleAtStart ? 'baseline-warning' : 'muted'}>
          {reference
            ? reference.staleAtStart
              ? '使用较旧快照 · 查看时间'
              : '查看报价时间与来源'
            : '历史数据，非今日市价 · 查看说明'}
        </span>
      </summary>
      <div className="baseline-content">
        {reference ? (
          <>
            <div className="baseline-facts">
              <p>
                <span>最早报价时间 · 北京时间</span>
                <b>{time(source.asOf!)}</b>
              </p>
              <p>
                <span>服务器获取时间 · 北京时间</span>
                <b>{time(reference.fetchedAt)}</b>
              </p>
              <p>
                <span>开局时数据年龄</span>
                <b>
                  {reference.ageAtStartSeconds < 60
                    ? '不足 1 分钟'
                    : `${Math.floor(reference.ageAtStartSeconds / 60)} 分钟`}{' '}
                  ·{' '}
                  {reference.delivery === 'downloaded'
                    ? '本次获取'
                    : reference.delivery === 'cache'
                      ? '共享缓存'
                      : '更新失败，使用缓存'}
                </b>
              </p>
            </div>
            {reference.warnings.map((warning) => (
              <p className="baseline-warning" key={warning}>
                {warning}
              </p>
            ))}
            <p>
              起点取自各直盘最近一根 1 分钟 K 线返回的 close 值；时间为该根 K
              线的标记时间，并非逐笔成交时间。该蜡烛可能尚未收盘。
            </p>
            <div className="table-scroll">
              <table>
                <caption>本局固定参考快照 · 所有时间为北京时间</caption>
                <thead>
                  <tr>
                    <th>原始直盘</th>
                    <th>原始 close</th>
                    <th>每单位货币值 USD</th>
                    <th>报价时间</th>
                  </tr>
                </thead>
                <tbody>
                  {reference.quotes.map((quote) => (
                    <tr key={quote.currency}>
                      <td>{quote.symbol}</td>
                      <td>{quote.close.toPrecision(7)}</td>
                      <td>
                        1 {quote.currency} = {quote.usdValue.toPrecision(7)}
                      </td>
                      <td>{time(quote.asOf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>
            本局以 2023
            年世界银行历史统计为依据。汇率采用年均值，再加入有界、相关的开局扰动；不是当天市价。可在「经济体
            → 现实基准与扰动」查看原始值、开局值和来源。
            {status?.referenceAvailable
              ? '可以在「新的一局」选择 Twelve Data 参考起点。'
              : status?.message}
          </p>
        )}
        <p>
          开局后的价格、内部景气与事件由模拟模型推演；开局前的 K
          线也是合成历史。缺失统计会明确标记模型假设，不能视为真实市场走势或预测。
        </p>
      </div>
    </details>
  );
}

import * as React from 'react'
import deepmerge from 'deepmerge'
import { Animated, View, ViewStyle } from 'react-native'
import { GestureDetector, Gesture, State, GestureHandlerRootView, GestureUpdateEvent, PanGestureHandlerEventPayload } from 'react-native-gesture-handler'
import fastEqual from 'fast-deep-equal/react'
import clamp from 'lodash.clamp'
import minBy from 'lodash.minby'
import maxBy from 'lodash.maxby'
import debounce from 'lodash.debounce'
import Svg, { G, Mask, Defs, Rect } from 'react-native-svg'
import { useComponentDimensions } from './useComponentDimensions'
import { AxisDomain, ChartDataPoint, Padding, ViewPort, TouchEvent, XYValue } from './types'
import { ChartContextProvider } from './ChartContext'
import { calculateDataDimensions, calculateViewportDomain } from './Chart.utils'
import { scalePointToDimensions } from './utils'

type Props = {
  /** All styling can be used except for padding. If you need padding, use the explicit `padding` prop below.*/
  style?: ViewStyle
  /** Data to be used by `<Area />` or `<Line />` children. Not required, and can be overridden in Area or Line components. */
  data?: ChartDataPoint[]
  /** Domain for the horizontal (X) axis. */
  xDomain?: AxisDomain
  /** Domain for the vertical (Y) axis. */
  yDomain?: AxisDomain
  /** Size of the viewport for the chart. Should always be <= the domain. */
  viewport?: ViewPort
  /** This disables touch for the chart. You can use this if you don't need tooltips. */
  disableTouch?: boolean
  /** This disables gestures for the chart. You can use this if you don't need scrolling in the chart. */
  disableGestures?: boolean
  /** Padding of the chart. Use this instead of setting padding in the `style` prop. */
  padding?: Padding
}

export type ChartHandle = {
  setViewportOrigin: (origin: XYValue) => void
}

const Chart: React.FC<React.PropsWithChildren<Props>> = React.memo(
  React.forwardRef<ChartHandle, React.PropsWithChildren<Props>>((props, ref) => {
    const { style, children, data = [], padding, xDomain, yDomain, viewport, disableGestures, disableTouch } = deepmerge(computeDefaultProps(props), props)
    const { dimensions, onLayout } = useComponentDimensions()
    const dataDimensions = calculateDataDimensions(dimensions, padding)

    const [lastTouch, setLastTouch] = React.useState<TouchEvent | undefined>(undefined)
    const [panX, setPanX] = React.useState<number>(viewport.initialOrigin.x)
    const [panY, setPanY] = React.useState<number>(viewport.initialOrigin.y)
    const [offset] = React.useState(new Animated.ValueXY({ x: viewport.initialOrigin.x, y: viewport.initialOrigin.y }))

    const viewportDomain = calculateViewportDomain(
      viewport,
      {
        x: xDomain,
        y: yDomain,
      },
      panX,
      panY,
    )

    const setViewportOrigin = (origin: XYValue) => {
      if (dataDimensions) {
        setPanX(origin.x)
        setPanY(origin.y)
        offset.x.setValue(origin.x)
      }
    }

    React.useImperativeHandle(ref, () => ({ setViewportOrigin }))

    const handleTouchEvent = React.useCallback(
      debounce(
        (x: number, y: number) => {
          if (dataDimensions) {
            setLastTouch({
              position: {
                x: clamp(x - padding.left, 0, dataDimensions.width),
                y: clamp(y - padding.top, 0, dataDimensions.height),
              },
              type: 'tap',
            })
          }

          return true
        },
        300,
        { leading: true, trailing: false },
      ),
      [JSON.stringify(dataDimensions)],
    )

    const handlePanEvent = (evt: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      if (dataDimensions) {
        const factorX = viewport.size.width / dataDimensions.width
        setPanX((offset.x as any)._value - evt.translationX * factorX)

        const factorY = viewport.size.height / dataDimensions.height
        setPanY((offset.y as any)._value + evt.translationY * factorY)

        if (evt.state === State.END) {
          offset.x.setValue(clamp((offset.x as any)._value - evt.translationX * factorX, xDomain.min, xDomain.max - viewport.size.width))
          offset.y.setValue(clamp((offset.y as any)._value + evt.translationY * factorY, yDomain.min, yDomain.max - viewport.size.height))
          setLastTouch({
            position: {
              x: clamp(evt.x - padding.left, 0, dataDimensions.width),
              y: clamp(evt.y - padding.top, 0, dataDimensions.height),
            },
            translation: {
              x: evt.translationX,
              y: evt.translationY,
            },
            type: 'panEnd',
          })
        } else {
          setLastTouch({
            position: {
              x: clamp(evt.x - padding.left, 0, dataDimensions.width),
              y: clamp(evt.y - padding.top, 0, dataDimensions.height),
            },
            translation: {
              x: evt.translationX,
              y: evt.translationY,
            },
            type: 'pan',
          })
        }
      }
      return true
    }

    const tap = Gesture.Tap()
      .enabled(!disableTouch)
      .onStart((e) => handleTouchEvent(e.x, e.y))
    const pan = Gesture.Pan().enabled(!disableGestures).minDistance(10).onUpdate(handlePanEvent)

    React.useImperativeHandle(ref, () => ({ setViewportOrigin }))

    const childComponents = React.Children.toArray(children)
    // undefined because ForwardRef (Line) has name undefined
    const lineAndAreaComponents = childComponents.filter((c) => ['Area', undefined].includes((c as any)?.type?.name))
    const otherComponents = childComponents.filter((c) => !['Area', undefined].includes((c as any)?.type?.name))

    return (
      <View style={style} onLayout={onLayout}>
        <GestureHandlerRootView>
          {!!dimensions && (
            <Animated.View style={{ width: dimensions.width, height: dimensions.height }}>
              <GestureDetector gesture={Gesture.Exclusive(tap, pan)}>
                <Animated.View style={{ width: dimensions.width, height: dimensions.height }}>
                  <ChartContextProvider
                    value={{
                      data,
                      dimensions: dataDimensions,
                      domain: {
                        x: xDomain,
                        y: yDomain,
                      },
                      viewportDomain,
                      viewportOrigin: scalePointToDimensions({ x: viewportDomain.x.min, y: viewportDomain.y.max }, viewportDomain, dataDimensions),
                      viewport,
                      lastTouch,
                    }}
                  >
                    <Svg width={dimensions.width} height={dimensions.height}>
                      <G translateX={padding.left} translateY={padding.top}>
                        {otherComponents}
                        <Defs>
                          {/* Mask to fix viewport overflow bugs */}
                          <Mask id="Mask" x={0} y={0} width={dataDimensions.width} height={dataDimensions.height}>
                            <Rect x="0" y="0" width={dataDimensions.width} height={dataDimensions.height} fill="#ffffff" />
                          </Mask>
                        </Defs>
                        {lineAndAreaComponents}
                      </G>
                    </Svg>
                  </ChartContextProvider>
                </Animated.View>
              </GestureDetector>
            </Animated.View>
          )}
        </GestureHandlerRootView>
      </View>
    )
  }),
  fastEqual,
)

export { Chart }

const computeDefaultProps = (props: Props) => {
  const { data = [] } = props

  const xDomain = props.xDomain ?? {
    min: data.length > 0 ? minBy(data, (d) => d.x)!.x : 0,
    max: data.length > 0 ? maxBy(data, (d) => d.x)!.x : 10,
  }

  const yDomain = props.yDomain ?? {
    min: data.length > 0 ? minBy(data, (d) => d.y)!.y : 0,
    max: data.length > 0 ? maxBy(data, (d) => d.y)!.y : 10,
  }

  return {
    padding: {
      left: 0,
      top: 0,
      bottom: 0,
      right: 0,
    },
    xDomain,
    yDomain,
    viewport: {
      size: { width: Math.abs(xDomain.max - xDomain.min), height: Math.abs(yDomain.max - yDomain.min) },
      initialOrigin: { x: xDomain.min, y: yDomain.min },
    },
  }
}

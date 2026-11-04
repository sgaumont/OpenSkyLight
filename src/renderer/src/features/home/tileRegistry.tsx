import type { ComponentType } from 'react'
import type { CalendarViewKind, HomeTileType } from '@shared/types'
import {
  BirdNetTile,
  CameraTile,
  TimerTile,
  ChoresProgressTile,
  ClockTile,
  ListTile,
  MealsTile,
  NewsTile,
  PhotoTile,
  StarBalancesTile,
  TodayEventsTile,
  WeatherTile,
  WeekAgendaTile,
  type TileProps
} from './tiles'
import { CountdownsTile } from '../countdowns/CountdownsTile'

export interface TileMeta {
  label: string
  description: string
  component: ComponentType<TileProps>
  /** view-mode tap navigates here */
  navTarget?: CalendarViewKind
  /** false = not offered in "Add a tile" (one already on the home screen keeps working) */
  pickable?: false
}

export const TILE_REGISTRY: Record<HomeTileType, TileMeta> = {
  todayEvents: {
    label: "Today's events",
    description: 'Everything on the calendar today',
    component: TodayEventsTile,
    navTarget: 'day'
  },
  weekAgenda: {
    label: 'This week',
    description: 'A compact 7-day agenda',
    component: WeekAgendaTile,
    navTarget: 'agenda'
  },
  weather: {
    label: 'Weather',
    description: 'Current conditions and forecast',
    component: WeatherTile
  },
  choresProgress: {
    label: 'Chores progress',
    description: "Today's chores, and who did the finished ones",
    // tapping claims a chore in place; the tile itself goes nowhere
    component: ChoresProgressTile
  },
  starBalances: {
    label: 'Game time',
    description: 'Game time each child has earned',
    component: StarBalancesTile,
    navTarget: 'chores'
  },
  list: {
    label: 'List',
    description: 'Unchecked items from a list you pick',
    component: ListTile,
    navTarget: 'lists'
  },
  meals: {
    label: 'Meals today',
    description: "Today's meal plan",
    component: MealsTile,
    navTarget: 'week'
  },
  clock: {
    label: 'Clock',
    description: 'Time and date',
    component: ClockTile,
    pickable: false
  },
  photo: {
    label: 'Photo',
    description: 'Cycling photos from your screensaver folder',
    component: PhotoTile
  },
  news: {
    label: 'News headlines',
    description: 'Top stories from a news feed you pick',
    component: NewsTile
  },
  camera: {
    label: 'Camera',
    description: 'Live view from an IP camera (RTSP)',
    component: CameraTile,
    pickable: false
  },
  birdnet: {
    label: 'Birds',
    description: 'Recent detections from your BirdNET-Go',
    component: BirdNetTile,
    pickable: false
  },
  timer: {
    label: 'Timers',
    description: 'Countdown timers — set by tap or voice',
    component: TimerTile
  },
  countdowns: {
    label: 'Countdowns',
    description: 'Days until birthdays, holidays and trips',
    component: CountdownsTile
  }
}

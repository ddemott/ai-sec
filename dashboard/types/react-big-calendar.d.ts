declare module 'react-big-calendar' {
  import * as React from 'react';

  export type View = 'month' | 'week' | 'work_week' | 'day' | 'agenda';

  export interface Event {
    title?: string;
    start: Date;
    end: Date;
    [key: string]: any;
  }

  export interface CalendarProps {
    localizer: any;
    events: Event[];
    view?: View;
    date?: Date;
    onView?: (view: View) => void;
    onNavigate?: (date: Date, view: View, action: string) => void;
    startAccessor?: string | ((event: Event) => Date);
    endAccessor?: string | ((event: Event) => Date);
    style?: React.CSSProperties;
    selectable?: boolean;
    resizable?: boolean;
    onSelectSlot?: (slotInfo: any) => void;
    onSelectEvent?: (event: Event) => void;
    onEventDrop?: (args: any) => void;
    onEventResize?: (args: any) => void;
    eventPropGetter?: (event: Event) => { style?: React.CSSProperties };
  }

  export class Calendar extends React.Component<CalendarProps> {}

  export function dateFnsLocalizer(config: any): any;
}

declare module 'react-big-calendar/lib/addons/dragAndDrop' {
  import { Calendar, CalendarProps } from 'react-big-calendar';

  export default function withDragAndDrop<T = Calendar<any>>(
    component: typeof Calendar
  ): React.ComponentType<CalendarProps & T>;
}

declare module 'react-big-calendar/lib/css/react-big-calendar.css';

declare module 'react-big-calendar/lib/addons/dragAndDrop/styles.css';

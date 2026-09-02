import type { FC } from 'react';
import { EmptyState, Page, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';

const DashboardPage: FC = () => {
  return (
    <WixDesignSystemProvider>
      <Page>
        <Page.Header
          title="Advanced Booking Rules"
          subtitle="This is a subtitle for your page"
        />
        <Page.Content>
          <EmptyState
            title="Advanced Booking Rules"
            subtitle="Edit your page code to change this text."
            skin="page"
          />
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default DashboardPage;

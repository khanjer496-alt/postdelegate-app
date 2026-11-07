import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { HandledResponseError } from '@gitroom/helpers/utils/custom.fetch.func';
export const SeparatePost: FC<{
  posts: string[];
  len: number;
  merge: (posts: string[]) => void;
  changeLoading: (loading: boolean) => void;
}> = (props) => {
  const { len, posts } = props;
  const t = useT();
  const fetch = useFetch();

  const notReversible = useCallback(async () => {
    if (
      await deleteDialog(
        'Are you sure you want to separate all posts? This action is not reversible.',
        'Yes'
      )
    ) {
      props.changeLoading(true);
      const merge = props.posts.join('\n');
      try {
        const { posts } = await (
          await fetch('/posts/separate-posts', {
            method: 'POST',
            body: JSON.stringify({
              content: merge,
              len: props.len,
            }),
          })
        ).json();

        props.merge(posts);
      } catch (e) {
        // a dialog already told the user why it stopped
        if (!(e instanceof HandledResponseError)) {
          throw e;
        }
      } finally {
        props.changeLoading(false);
      }
    }
  }, [len, posts]);

  return (
    <Button className="!h-[30px] !text-sm !bg-red-800 text-white" onClick={notReversible}>
      {t('separate_post', 'Separate post to multiple posts')}
    </Button>
  );
};
